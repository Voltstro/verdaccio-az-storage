import { join } from 'node:path';
import type { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import type {
    Config,
    IPackageStorage,
    IPluginStorage,
    LocalStorage,
    Logger,
    PluginOptions,
    Token,
    onEndSearchPackage,
} from '@verdaccio/types';
import {
    setupConnectionStringAuth,
    setupDefaultAzureCredentialAuth,
    setupStorageSharedKeyCredential,
} from './azureAuth';
import AzureStoragePackageManager from './azureStoragePackageManager';
import type { AzureStoragePluginConfig } from './azureStoragePluginConfig';
import { LOGGER_PREFIX } from './constants';
import {
    AppConfigLocalStorageProvider,
    type ILocalStorageProvider,
    StorageBlobLocalStorageProvider,
} from './localStorage';

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
            this.logger.error(
                'Config for Azure storage plugin is missing! Add `store.az-storage` to your config file!',
            );
            throw new Error();
        }

        //Copy config
        this.config = Object.assign(config, config.store['az-storage']);

        const authMethod = process.env.AZ_STORAGE_AUTH_METHOD || this.config.authMethod || 'ConnectionString';
        const containerName = process.env.AZ_STORAGE_CONTAINER_NAME || this.config.containerName;
        const accountName = process.env.AZ_STORAGE_ACCOUNT_NAME || this.config.accountName;
        const accountKey = process.env.AZ_STORAGE_ACCOUNT_KEY || this.config.accountKey;
        const accountDomain =
            process.env.AZ_STORAGE_ACCOUNT_DOMAIN || this.config.accountDomain || 'blob.core.windows.net';

        switch (authMethod) {
            case 'ConnectionString': {
                const { blobClient, containerClient } = setupConnectionStringAuth(
                    this.logger,
                    process.env.AZ_STORAGE_CONNECTION_STRING || this.config.connectionString!,
                    containerName,
                );
                this.azureBlobClient = blobClient;
                this.azureContainerClient = containerClient;
                break;
            }

            case 'DefaultAzureCredential': {
                if (!accountName) {
                    throw new Error('Account name is required!');
                }
                const { blobClient, containerClient } = setupDefaultAzureCredentialAuth(
                    this.logger,
                    accountName,
                    containerName,
                    accountDomain,
                );
                this.azureBlobClient = blobClient;
                this.azureContainerClient = containerClient;
                break;
            }

            case 'StorageSharedKeyCredential': {
                if (!accountName) {
                    throw new Error('Account name is required!');
                }
                if (!accountKey) {
                    throw new Error('Account key is required!');
                }
                const { blobClient, containerClient } = setupStorageSharedKeyCredential(
                    this.logger,
                    accountName,
                    accountKey,
                    containerName,
                    accountDomain,
                );
                this.azureBlobClient = blobClient;
                this.azureContainerClient = containerClient;
                break;
            }

            default:
                this.logger.error(`${LOGGER_PREFIX}: Unsupported authentication method: ${authMethod}`);
                throw new Error(`Unsupported authentication method: ${authMethod}`);
        }

        //Create local storage provider
        const appConfigConnectionString =
            process.env.AZ_STORAGE_APP_CONFIG_CONNECTION_STRING ?? this.config.appConfigConnectionString;
        if (appConfigConnectionString) {
            this.localStorageProvider = new AppConfigLocalStorageProvider(
                this.logger,
                appConfigConnectionString,
                this.config,
            );
            this.logger.info(`${LOGGER_PREFIX}: Using Azure app configuration for local storage`);
        } else {
            this.localStorageProvider = new StorageBlobLocalStorageProvider(this.logger, this.azureContainerClient);
            this.logger.info(`${LOGGER_PREFIX}: Using Azure storage blob for local storage`);
        }

        //Default value for packagesDir
        if (!this.config.packagesDir) this.config.packagesDir = 'packages';
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
    public async search(onPackage: Function, onEnd: onEndSearchPackage): Promise<void> {
        try {
            const localStorage = await this.getOrCreateLocalStorage();
            const packageList = localStorage.list as string[];

            this.logger.debug({ count: packageList.length }, `${LOGGER_PREFIX}: Got @{count} packages for searching.`);

            const storageInfoMap = packageList.map(this.searchFetchInfo.bind(this, onPackage));
            await Promise.all(storageInfoMap);
            onEnd();
        } catch (ex) {
            onEnd(ex);
        }
    }

    private async searchFetchInfo(onPackage: Function, packageName: string): Promise<void> {
        return new Promise((resolve) => {
            const packagePath = join(this.config.packagesDir, packageName, 'package.json');
            const packageBlobClient = this.azureContainerClient.getBlobClient(packagePath);

            packageBlobClient
                .getProperties()
                .then((packageProperties) => {
                    if (!packageProperties.lastModified) return resolve();

                    return onPackage(
                        {
                            name: packageName,
                            path: packageName,
                            time: packageProperties.lastModified.getTime(),
                        },
                        resolve,
                    );
                })
                .catch((error) => {
                    this.logger.warn(
                        { packageName, error },
                        `${LOGGER_PREFIX}: Failed getting @{packageName}! @{error}`,
                    );
                });
        });
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
        if (!this.localStorage) {
            try {
                this.localStorage = await this.localStorageProvider.getLocalStorage();
            } catch (ex) {
                this.logger.error(
                    { ex },
                    `${LOGGER_PREFIX}: Error in getting local storage from local storage provider! @{ex}`,
                );
                throw ex;
            }

            //New local storage
            if (!this.localStorage) {
                this.logger.warn(`${LOGGER_PREFIX}: Local storage doesn't exist. Pre-creating local storage...`);
                this.localStorage = { list: [], secret: '' };
            }
        }

        return this.localStorage;
    }

    private async writeLocalStorage(): Promise<void> {
        try {
            await this.localStorageProvider.saveLocalStorage(this.localStorage!);
        } catch (ex) {
            this.logger.error(
                { ex },
                `${LOGGER_PREFIX}: Error in saving local storage from local storage provider! @{ex}`,
            );
            throw ex;
        }
    }
}
