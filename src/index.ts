import { Config, IPackageStorage, IPluginStorage, LocalStorage, Logger, PluginOptions, Token, TokenFilter, onEndSearchPackage, onSearchPackage, onValidatePackage } from "@verdaccio/legacy-types";
import { AzureBlobConfig } from "./storageConfig";
import { BlobServiceClient, BlockBlobClient, ContainerClient } from "@azure/storage-blob";
import AzureBlobPackageManager from "./storage";

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
            throw new Error('Azure Blob storage is missing its config!. Add `store.az-blob` to your config file!');

        this.config = Object.assign(config, config.store['az-blob']);

        if(!this.config.connectionString)
            throw new Error('A connection string is required!');

        if(!this.config.containerName)
            throw new Error('A container name is required!');

        this.azureBlobClient = BlobServiceClient.fromConnectionString(config.connectionString);
        this.azureContainerClient = this.azureBlobClient.getContainerClient(config.containerName);

        this.localStorageBlobClient = this.azureContainerClient.getBlockBlobClient('.verdaccio-s3-db.json');
    }

    /**
     * Adds a package to the list
     */
    public add(name: string, callback: Function): void {
        this.getData().then(async (data) => {
            if (data.list.indexOf(name) === -1) {
                data.list.push(name);
                this.logger.trace({ name }, 'Azure Blob Storage: [add] @{name} has been added');
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
        throw new Error("Method not implemented.");
    }

    /**
     * Gets package list
     */
    public get(callback: Function): void {
        this.getData().then((storage) => callback(null, storage.list));
    }

    /**
     * Get Verdaccio's secret
     */
    public async getSecret(): Promise<string> {
        return (await this.getData()).secret;
    }

    /**
     * Sets Verdaccio's secret
     */
    public async setSecret(secret: string): Promise<any> {
        (await this.getData()).secret = secret;

        await this.writeLocalStorage();
    }

    public getPackageStorage(packageInfo: string): IPackageStorage {
        return new AzureBlobPackageManager(packageInfo, this.logger, this.azureContainerClient);
    }

    public search(onPackage: onSearchPackage, onEnd: onEndSearchPackage, validateName: onValidatePackage): void {
        throw new Error("Method not implemented.");
    }

    public saveToken(token: Token): Promise<any> {
        throw new Error("Method not implemented.");
    }

    public deleteToken(user: string, tokenKey: string): Promise<any> {
        throw new Error("Method not implemented.");
    }

    public readTokens(filter: TokenFilter): Promise<Token[]> {
        throw new Error("Method not implemented.");
    }

    private async getData(): Promise<LocalStorage> {
        //if(!this.localStorage)
        //    this.localStorage = await this.getOrCreateLocalStorage();

        if(!this.localStorage)
            await this.getOrCreateLocalStorage();

        return this.localStorage!;

       // return this.localStorage;
    }

    private async getOrCreateLocalStorage(): Promise<void> {
        const exists = await this.localStorageBlobClient.exists();
        if(exists) {
            this.logger.info('Azure Blob Storage: Getting local storage...')
            const blob = await this.localStorageBlobClient.downloadToBuffer();
            const jsonRaw = blob.toString('utf-8');
            this.localStorage = JSON.parse(jsonRaw) as LocalStorage;

            //return JSON.parse(jsonRaw) as LocalStorage;
        } else {
            //New local storage
            this.localStorage = {list: [], secret: ''};
            this.logger.warn(`Azure Blob Storage: Local storage doesn't exist, creating...`);

            //Write local storage
            await this.writeLocalStorage();
            //return newLocalStorage;
        }
    }

    private async writeLocalStorage(): Promise<void> {
        const jsonBuffer = Buffer.from(JSON.stringify(this.localStorage), 'utf-8');
        await this.localStorageBlobClient.uploadData(jsonBuffer);
    }
}
