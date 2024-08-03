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
import { BlockBlobClient, ContainerClient } from '@azure/storage-blob';
import { ReadTarball, UploadTarball } from '@verdaccio/streams';
import { getConflict } from '@verdaccio/commons-api';
import { LOGGER_PREFIX } from './constants';

const PACKAGES_DIR = 'packages/';

export default class AzureBlobPackageManager implements ILocalPackageManager {
    public logger: Logger;

    private readonly packageName: string;
    private readonly containerClient: ContainerClient;
    private readonly packageBlobClient: BlockBlobClient;

    public constructor(packageName: string, logger: Logger, containerClient: ContainerClient) {
        this.logger = logger;

        this.packageName = packageName;
        this.containerClient = containerClient;
        this.packageBlobClient = containerClient.getBlockBlobClient(join(PACKAGES_DIR, packageName, 'package.json'));
    }

    /**
     * Writes package's tarball
     */
    public writeTarball(name: string): IUploadTarball {
        const uploadStream = new UploadTarball({});

        let streamEnded = 0;
        uploadStream.on('end', () => {
            streamEnded = 1;
        });
        
        const promise = new Promise((resolve) => {
            const packageClient = this.containerClient.getBlockBlobClient(join(PACKAGES_DIR, this.packageName, name));
            packageClient.uploadStream(uploadStream, undefined, undefined, {
                blobHTTPHeaders: {
                    blobContentType: 'application/x-compressed'
                }
            })
                .then(() => resolve(undefined));
        });

        uploadStream.done = (): void => {
            const onEnd = async (): Promise<void> => {
                try {
                    await promise;
                    this.logger.debug(`${LOGGER_PREFIX}: Finished uploading package tarball`);
                    uploadStream.emit('success');
                } catch (error) {
                    this.logger.error( { error }, `${LOGGER_PREFIX}: Error creating package tarball: @{error}`);
                    uploadStream.emit('error', error);
                }
            };

            if (streamEnded) {
                onEnd();
            } else {
                uploadStream.on('end', onEnd);
            }
        };

        return uploadStream;
    }

    /**
     * Read's package's tarball
     */
    public readTarball(name: string): ReadTarball {
        const readTarballStream = new ReadTarball({});

        const promise = new Promise((resolve) => {
            const packageClient = this.containerClient.getBlockBlobClient(join(PACKAGES_DIR, this.packageName, name));
            packageClient.downloadToBuffer().then((buffer) => resolve(buffer));
        });

        readTarballStream.emit('pipe', async () => {
            try {
                const data = await promise;
                //src = data;
                this.logger.debug(`${LOGGER_PREFIX}: Finished reading package tarball`);

                return data;
                //return true;
            } catch(error) {
                this.logger.error({ error }, `${LOGGER_PREFIX}: Error reading package tarball: @{error}`);
                readTarballStream.emit('error', error);
            }
        });

        return readTarballStream;
    }

    /**
     * Reads package data
     */
    public readPackage(fileName: string, callback: ReadPackageCallback): void {
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
        const packageClient = this.containerClient.getBlockBlobClient(join(PACKAGES_DIR, this.packageName, fileName));
        packageClient.delete().then(() => {
            this.logger.debug(`${LOGGER_PREFIX}: Finished deleting package data`);
            callback(null);
        }).catch((error) => {
            this.logger.error({ error }, `${LOGGER_PREFIX}: Error deleting package data: @{error}`);
            callback(error);
        });
    }

    public removePackage(callback: CallbackAction): void {
        throw new Error('Method not implemented.');
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
        await this.packageBlobClient.uploadData(jsonBuffer, {
            blobHTTPHeaders: {
                blobContentType: 'application/json'
            }
        });
    }
}