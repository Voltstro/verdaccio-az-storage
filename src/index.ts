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
import { AzureBlobConfig } from './storageConfig';
import AzureBlobPackageManager from './storage';
import { LOGGER_PREFIX } from './constants';

const DB_FILE_NAME = '.verdaccio-db.json';

export default class AzureBlobStorageDatabase implements IPluginStorage<AzureBlobConfig> {
    public logger: Logger;
    public config: AzureBlobConfig & Config;
    public version?: string | undefined;

    private localStorage?: LocalStorage;
    private localStorageBlobClient: BlockBlobClient;

    private azureBlobClient: BlobServiceClient;
    private azureContainerClient: ContainerClient;

    public constructor(config: Config, options: PluginOptions<AzureBlobConfig>) {
        this.logger = options.logger;

        if (!config)
            throw new Error('Azure Blob storage is missing its config! Add `store.az-blob` to your config file!');

        this.config = Object.assign(config, config.store['az-blob']);

        if(!this.config.connectionString)
            throw new Error('A connection string is required!');

        if(!this.config.containerName)
            throw new Error('A container name is required!');

        this.azureBlobClient = BlobServiceClient.fromConnectionString(config.connectionString);
        this.azureContainerClient = this.azureBlobClient.getContainerClient(config.containerName);

        this.localStorageBlobClient = this.azureContainerClient.getBlockBlobClient(DB_FILE_NAME);
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
        return new AzureBlobPackageManager(packageInfo, this.logger, this.azureContainerClient);
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
