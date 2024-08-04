import { join } from 'path';
import {
    Config,
    IPackageStorage,
    IPluginStorage,
    LocalStorage,
    Logger,
    PluginOptions,
    Token,
    onEndSearchPackage,
    onSearchPackage
} from '@verdaccio/legacy-types';
import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { AzureStoragePluginConfig } from './azureStoragePluginConfig';
import AzureStoragePackageManager from './azureStoragePackageManager';
import { LOGGER_PREFIX } from './constants';
import { AppConfigLocalStorageProvider, ILocalStorageProvider, StorageBlobLocalStorageProvider } from './localStorage';

export class AzureStoragePlugin implements IPluginStorage<AzureStoragePluginConfig> {
    public logger: Logger;
    public config: AzureStoragePluginConfig & Config;
    public version?: string | undefined;

    private localStorage?: LocalStorage;

    private azureBlobClient: BlobServiceClient;
    private azureContainerClient: ContainerClient;

    private localStorageProvider: ILocalStorageProvider;

    public constructor(config: Config, options: PluginOptions<AzureStoragePluginConfig>) {
        this.logger = options.logger;

        if (!config) {
            this.logger.error('Config for Azure storage plugin is missing! Add `store.az-storage` to your config file!');
            throw new Error();
        }
            
        //Copy config
        this.config = Object.assign(config, config.store['az-storage']);

        //Try to get connection string for storage account
        let connectionString = process.env.AZ_STORAGE_CONNECTION_STRING;
        if(!connectionString)
        {
            this.logger.debug(`${LOGGER_PREFIX}: Reading connection string from config instead of environment variable`);
            connectionString = this.config.connectionString;
        }

        //None is set at all, quit
        if(!connectionString) {
            this.logger.error(`${LOGGER_PREFIX}: Connection string is required! Either set 'connectionString' in the config, or set 'AZ_STORAGE_CONNECTION_STRING' environment variable.`);
            throw new Error();
        }

        //Container name
        if(!this.config.containerName) {
            this.logger.error(`${LOGGER_PREFIX}: Container name is required! Set 'containerName' in the config.`);
            throw new Error();
        }

        //Pre-create clients
        try {
            this.azureBlobClient = BlobServiceClient.fromConnectionString(connectionString);
        } catch(ex) {
            this.logger.error({ ex }, `${LOGGER_PREFIX}: Error creating Azure blob client! @{ex}`);
            throw ex;
        }

        try {
            this.azureContainerClient = this.azureBlobClient.getContainerClient(config.containerName);
        } catch(ex) {
            this.logger.error({ ex }, `${LOGGER_PREFIX}: Error creating Azure container client! Does the container exist? @{ex}`);
            throw ex;
        }

        //Create local storage provider
        const appConfigConnectionString = process.env.AZ_STORAGE_APP_CONFIG_CONNECTION_STRING ?? this.config.appConfigConnectionString;
        if(appConfigConnectionString) {
            this.localStorageProvider = new AppConfigLocalStorageProvider(this.logger, appConfigConnectionString, this.config);
            this.logger.info(`${LOGGER_PREFIX}: Using Azure app configuration for local storage`);
        } else {
            this.localStorageProvider = new StorageBlobLocalStorageProvider(this.logger, this.azureContainerClient);
            this.logger.info(`${LOGGER_PREFIX}: Using Azure storage blob for local storage`);
        }

        //Default value for packagesDir
        if(!this.config.packagesDir)
            this.config.packagesDir = 'packages';
    }

    /**
     * Adds a package to the list
     */
    public add(name: string, callback: Function): void {
        this.getOrCreateLocalStorage().then(async (data) => {
            if (data.list.indexOf(name) === -1) {
                data.list.push(name);
                this.logger.debug({ name }, `${LOGGER_PREFIX}: Added package @{name}`);
                try {
                    await this.writeLocalStorage();
                    callback(null);
                } catch (err) {
                    callback(err);
                }
            } else {
                callback(null);
            }
        });
    }

    /**
     * Removes a package from the list
     */
    public remove(name: string, callback: Function): void {
        this.getOrCreateLocalStorage().then(async (data) => {
            const pkgIndex = data.list.indexOf(name);
            if (pkgIndex !== -1) {
                data.list.splice(pkgIndex, 1);
                this.logger.debug({ name }, `${LOGGER_PREFIX}: Removed package @{name}`);
            }

            try {
                await this.writeLocalStorage();
                callback(null);
            } catch (err) {
                callback(err);
            }
        });
    }

    /**
     * Gets package list
     */
    public get(callback: Function): void {
        this.getOrCreateLocalStorage().then((storage) => callback(null, storage.list));
    }

    /**
     * Get Verdaccio's secret
     */
    public async getSecret(): Promise<string> {
        return (await this.getOrCreateLocalStorage()).secret;
    }

    /**
     * Sets Verdaccio's secret
     */
    public async setSecret(secret: string): Promise<void> {
        (await this.getOrCreateLocalStorage()).secret = secret;

        await this.writeLocalStorage();
    }

    /**
     * Gets IPackageStorage for a package
     */
    public getPackageStorage(packageInfo: string): IPackageStorage {
        return new AzureStoragePackageManager(packageInfo, this.config, this.logger, this.azureContainerClient);
    }

    /**
     * Searching
     */
    public async search(onPackage: onSearchPackage, onEnd: onEndSearchPackage): Promise<void> {
        try {
            const localStorage = await this.getOrCreateLocalStorage();
            const packageList = localStorage.list as string[];

            this.logger.debug({ count: packageList.length }, `${LOGGER_PREFIX}: Got @{count} packages for searching.`);

            for(const packageName of packageList) {
                const packagePath = join(this.config.packagesDir, packageName, 'package.json');
                const packageBlobClient = this.azureContainerClient.getBlobClient(packagePath);
                const exists = await packageBlobClient.exists();

                if(exists) {
                    const packageProperties = await packageBlobClient.getProperties();
                    onPackage({
                        name: packageName,
                        time: {
                            created: packageProperties.createdOn!.toISOString(),
                            modified: packageProperties.lastModified!.toISOString(),
                        },
                        versions: {},
                        'dist-tags': {},
                        _distfiles: {},
                        _attachments: {},
                        _uplinks: {},
                        _rev: ''
                    }, () => {});
                    this.logger.debug({ packageName }, `${LOGGER_PREFIX}: Got package @{packageName}`);
                    continue;
                }

                this.logger.warn({ packageName }, `${LOGGER_PREFIX}: Have package @{packageName}, which does not have matching package data!`);
            }
        } catch(ex) {
            onEnd(ex);
            return;
        }

        onEnd(null);
    }

    public saveToken(): Promise<Token> {
        throw new Error('Method not implemented.');
    }

    public deleteToken(): Promise<Token> {
        throw new Error('Method not implemented.');
    }

    public readTokens(): Promise<Token[]> {
        throw new Error('Method not implemented.');
    }

    /**
     * Gets (or creates if needed) local storage
     */
    private async getOrCreateLocalStorage(): Promise<LocalStorage> {
        if(!this.localStorage) {
            try {
                this.localStorage = await this.localStorageProvider.getLocalStorage();
            } catch(ex) {
                this.logger.error({ ex }, `${LOGGER_PREFIX}: Error in getting local storage from local storage provider! @{ex}`);
                throw ex;
            }

            //New local storage
            if(!this.localStorage) {
                this.logger.warn(`${LOGGER_PREFIX}: Local storage doesn't exist. Pre-creating local storage...`);
                this.localStorage = { list: [], secret: '' };
            }
        }

        return this.localStorage;
    }

    private async writeLocalStorage(): Promise<void> {
        try {
            await this.localStorageProvider.saveLocalStorage(this.localStorage!);
        } catch(ex) {
            this.logger.error({ ex }, `${LOGGER_PREFIX}: Error in saving local storage from local storage provider! @{ex}`);
            throw ex;
        }
    }
}
