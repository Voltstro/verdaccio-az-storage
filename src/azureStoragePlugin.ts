import {
    Config,
    IPackageStorage,
    IPluginStorage,
    LocalStorage,
    Logger,
    PluginOptions,
    Token,
    onEndSearchPackage,
    onSearchPackage,
    onValidatePackage
} from '@verdaccio/legacy-types';
import { BlobServiceClient, BlockBlobClient, ContainerClient } from '@azure/storage-blob';
import { AzureStoragePluginConfig } from './azureStoragePluginConfig';
import AzureStoragePackageManager from './azureStoragePackageManager';
import { LOGGER_PREFIX } from './constants';

const DB_FILE_NAME = '.verdaccio-db.json';

export class AzureStoragePlugin implements IPluginStorage<AzureStoragePluginConfig> {
    public logger: Logger;
    public config: AzureStoragePluginConfig & Config;
    public version?: string | undefined;

    private localStorage?: LocalStorage;
    private localStorageBlobClient: BlockBlobClient;

    private azureBlobClient: BlobServiceClient;
    private azureContainerClient: ContainerClient;

    public constructor(config: Config, options: PluginOptions<AzureStoragePluginConfig>) {
        this.logger = options.logger;

        if (!config) {
            this.logger.error('Config for Azure storage plugin is missing! Add `store.az-storage` to your config file!');
            throw new Error();
        }
            

        //Copy config
        this.config = Object.assign(config, config.store['az-storage']);

        //Try to get connection string
        let connectionString = process.env.AZ_STORAGE_CONNECTION_STRING;
        if(!connectionString)
        {
            this.logger.debug(`${LOGGER_PREFIX}: Reading connection string from config instead of environment variable`);
            connectionString = this.config.connectionString;
        }

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

        try {
            this.localStorageBlobClient = this.azureContainerClient.getBlockBlobClient(DB_FILE_NAME);
        } catch(ex) {
            this.logger.error({ dbFile: DB_FILE_NAME, ex }, `${LOGGER_PREFIX}: Error creating Azure storage blob client for @{dbFile}! @{ex}`);
            throw ex;
        }
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
     * Removes a package from he list
     */
    public remove(name: string, callback: Function): void {
        throw new Error('Method not implemented.');
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
    public async setSecret(secret: string): Promise<any> {
        (await this.getOrCreateLocalStorage()).secret = secret;

        await this.writeLocalStorage();
    }

    public getPackageStorage(packageInfo: string): IPackageStorage {
        return new AzureStoragePackageManager(packageInfo, this.logger, this.azureContainerClient);
    }

    public search(onPackage: onSearchPackage, onEnd: onEndSearchPackage, validateName: onValidatePackage): void {
        throw new Error('Method not implemented.');
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
            const exists = await this.localStorageBlobClient.exists();
            if(exists) {
                //DB file exists in container, fetch it
                this.logger.info(`${LOGGER_PREFIX}: Getting local storage...`);
                const blob = await this.localStorageBlobClient.downloadToBuffer();
                const jsonRaw = blob.toString('utf-8');

                this.localStorage = JSON.parse(jsonRaw) as LocalStorage;
            } else {
                //New local storage
                this.localStorage = { list: [], secret: '' };
                this.logger.warn(`${LOGGER_PREFIX}: Local storage doesn't exist, creating...`);
    
                await this.writeLocalStorage();
            }
        }

        return this.localStorage;
    }

    private async writeLocalStorage(): Promise<void> {
        const jsonBuffer = Buffer.from(JSON.stringify(this.localStorage), 'utf-8');
        await this.localStorageBlobClient.uploadData(jsonBuffer, {
            blobHTTPHeaders: {
                blobContentType: 'application/json'
            }
        });
    }
}
