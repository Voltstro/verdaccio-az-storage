import { join } from 'path';
import {
    Logger,
    Package,
    ILocalPackageManager,
    CallbackAction,
    ReadPackageCallback,
    IUploadTarball,
    Manifest,
    PackageTransformer,
    StorageUpdateCallback,
    StorageWriteCallback,
} from '@verdaccio/legacy-types';
import { BlobHTTPHeaders, BlockBlobClient, ContainerClient } from '@azure/storage-blob';
import { ReadTarball, UploadTarball } from '@verdaccio/streams';
import { getConflict, getNotFound, HEADERS } from '@verdaccio/commons-api';
import { LOGGER_PREFIX } from './constants';
import { AzureStoragePluginConfig } from './azureStoragePluginConfig';

export default class AzureStoragePackageManager implements ILocalPackageManager {
    public logger: Logger;

    private readonly packageName: string;
    private readonly config: AzureStoragePluginConfig;
    private readonly containerClient: ContainerClient;
    private readonly packageBlobClient: BlockBlobClient;

    public constructor(packageName: string, config: AzureStoragePluginConfig, logger: Logger, containerClient: ContainerClient) {
        this.logger = logger;

        this.packageName = packageName;
        this.config = config;
        this.containerClient = containerClient;
        this.packageBlobClient = containerClient.getBlockBlobClient(join(this.config.packagesDir, packageName, 'package.json'));
    }

    /**
     * Writes package's tarball
     */
    public writeTarball(name: string): IUploadTarball {
        const uploadStream = new UploadTarball({});
        uploadStream.pause();
        const packagePath = join(this.config.packagesDir, this.packageName, name);
        
        const packageClient = this.containerClient.getBlockBlobClient(packagePath);

        //Setup headers
        const httpHeaders: BlobHTTPHeaders = {
            blobContentType: 'application/x-compressed-tar'
        };
        if(this.config.cachePackageTime) {
            httpHeaders.blobCacheControl = `public,max-time=${this.config.cachePackageTime}`;
            this.logger.debug(`${LOGGER_PREFIX}: Using ${this.config.cachePackageTime} seconds as cache-control on package`);
        }

        //Timeout to allow streams to be ready
        setTimeout(() => {
            uploadStream.resume();
            this.logger.info({ packagePath }, `${LOGGER_PREFIX}: Uploading package to @{packagePath}`);
            packageClient.uploadStream(uploadStream, undefined, undefined, {
                blobHTTPHeaders: httpHeaders
            })
                .then(() => {
                    uploadStream.emit('success');
                    this.logger.info({ packagePath }, `${LOGGER_PREFIX}: Finished uploading package to @{packagePath}`);
                })
                .catch((error) => uploadStream.emit('error', error));
            uploadStream.emit('open');
        }, 1);

        return uploadStream;
    }

    /**
     * Read's package's tarball
     */
    public readTarball(name: string): ReadTarball {
        const readTarballStream = new ReadTarball({});
        const packagePath = join(this.config.packagesDir, this.packageName, name);

        const client = this.containerClient.getBlobClient(packagePath);
        client.exists().then((exists) => {
            if(!exists) {
                readTarballStream.emit('error', getNotFound());
                this.logger.warn({ packagePath }, `${LOGGER_PREFIX}: Package @{packagePath} does not exist.`);
            } else {
                //With tarball_url_redirect enabled, just emit an open event so Verdaccio will redirect
                if('experiments' in this.config && 'tarball_url_redirect' in this.config.experiments) {
                    readTarballStream.emit('open');
                    return;
                }

                client.download().then(result => {
                    this.logger.debug(`${LOGGER_PREFIX}: Finished downloading package tarball, piping to stream.`);
                    readTarballStream.emit('open');
                    readTarballStream.emit(HEADERS.CONTENT_LENGTH, result.contentLength);
                    result.readableStreamBody!.pipe(readTarballStream);
                });
            }

        }).catch((error) => {
            this.logger.error({ error }, `${LOGGER_PREFIX}: Error reading package tarball! @{error}`);
            readTarballStream.emit('error', error);
        });

        return readTarballStream;
    }

    /**
     * Reads package data
     */
    public readPackage(fileName: string, callback: ReadPackageCallback): void {
        this.logger.debug({ fileName }, `${LOGGER_PREFIX}: readPackage for package @{fileName}`);

        this.getPackageData().then((packageData) => {
            this.logger.debug(`${LOGGER_PREFIX}: Finished reading package data`);
            callback(null, packageData);
        }).catch((error) => {
            this.logger.error({ error }, `${LOGGER_PREFIX}: Error reading package data: @{error}`);
            callback(error);
        });
    }

    /**
     * Creates package data
     */
    public createPackage(pkgName: string, value: Manifest, cb: CallbackAction): void {
        this.logger.debug({ pkgName }, `${LOGGER_PREFIX}: createPackage for package @{pkgName}`);

        this.packageBlobClient.exists().then((exists) => {
            //Make sure package doesn't already exist
            if(exists) {
                cb(getConflict('Package data already exists'));
                return;
            }

            this.savePackage(pkgName, value, cb);
        }).catch((error) => {
            this.logger.error({ error }, `${LOGGER_PREFIX}: Error creating package data: @{error}`);
            cb(error);
        });
    }

    /**
     * Deletes package data
     */
    public deletePackage(fileName: string, callback: CallbackAction): void {
        const packageClient = this.containerClient.getBlockBlobClient(join(this.config.packagesDir, this.packageName, fileName));
        packageClient.delete().then(() => {
            this.logger.debug(`${LOGGER_PREFIX}: Finished deleting package data`);
            callback(null);
        }).catch((error) => {
            this.logger.error({ error }, `${LOGGER_PREFIX}: Error deleting package data: @{error}`);
            callback(error);
        });
    }

    public removePackage(callback: CallbackAction): void {
        callback(null);
    }

    /**
     * Updates package data
     */
    public updatePackage(name: string, updateHandler: StorageUpdateCallback, onWrite: StorageWriteCallback, transformPackage: PackageTransformer, onEnd: CallbackAction): void {
        this.getPackageData().then((packageData) => {
            updateHandler(packageData, (error) => {
                if(error) {
                    this.logger.error({ error }, `${LOGGER_PREFIX}: Error updating package data: @{error}`);
                    onEnd(error);
                    return;
                }

                const transformedPackage = transformPackage(packageData);
                onWrite(name, transformedPackage, onEnd);
            });
        });
    }

    /**
     * Saves package data
     */
    public savePackage(fileName: string, json: Manifest, callback: CallbackAction): void {
        this.writePackageData(json).then(() => {
            this.logger.debug(`${LOGGER_PREFIX}: Finished saving package data`);
            callback(null);
        }).catch((error) => {
            this.logger.error({ error }, `${LOGGER_PREFIX}: Error saving package data: @{error}`);
            callback(error);
        });
    }

    private async getPackageData(): Promise<Package> {
        const exists = await this.packageBlobClient.exists();
        let packageData: Package;
        if(exists) {
            //Read package data
            const blob = await this.packageBlobClient.downloadToBuffer();
            const jsonRaw = blob.toString('utf-8');
            packageData = JSON.parse(jsonRaw) as Package;
        } else {
            //Precreate
            packageData = {
                name: this.packageName,
                versions: {},
                'dist-tags': {},
                _distfiles: {},
                _attachments: {},
                _uplinks: {},
                _rev: ''
            };

            await this.writePackageData(packageData);
        }

        return packageData;
    }

    private async writePackageData(packageData: Package): Promise<void> {
        const jsonBuffer = Buffer.from(JSON.stringify(packageData), 'utf-8');

        const httpHeaders: BlobHTTPHeaders = {
            blobContentType: 'application/json'
        };

        if(this.config.cachePackageDataTime) {
            httpHeaders.blobCacheControl = `public,max-time=${this.config.cachePackageDataTime}`;
            this.logger.debug(`${LOGGER_PREFIX}: Using ${this.config.cachePackageDataTime} seconds as cache-control on package data`);
        }  

        await this.packageBlobClient.uploadData(jsonBuffer, {
            blobHTTPHeaders: httpHeaders
        });
    }
}
