import { LocalStorage, Logger } from '@verdaccio/legacy-types';
import { ILocalStorageProvider } from '../localStorageProvider';
import { BlockBlobClient, ContainerClient } from '@azure/storage-blob';
import { LOGGER_PREFIX } from '../../constants';

const DB_FILE_NAME = '.verdaccio-db.json';

/**
 * ILocalStorageProvider that uses blob in an Azure storage container
 */
export class StorageBlobLocalStorageProvider implements ILocalStorageProvider {
    private logger: Logger;
    private localStorageBlobClient: BlockBlobClient;

    constructor(logger: Logger, containerClient: ContainerClient) {
        this.logger = logger;
        try {
            this.localStorageBlobClient = containerClient.getBlockBlobClient(DB_FILE_NAME);
        } catch(ex) {
            this.logger.error({ dbFile: DB_FILE_NAME, ex }, `${LOGGER_PREFIX}: Error creating Azure storage blob client for @{dbFile}! @{ex}`);
            throw ex;
        }
    }

    public async getLocalStorage(): Promise<LocalStorage | undefined> {
        const exists = await this.localStorageBlobClient.exists();
        if(exists) {
            //DB file exists in container, fetch it
            this.logger.debug(`${LOGGER_PREFIX}: Getting local storage...`);
            const blob = await this.localStorageBlobClient.downloadToBuffer();
            const jsonRaw = blob.toString('utf-8');

            return JSON.parse(jsonRaw) as LocalStorage;
        }

        return undefined;
    }

    public async saveLocalStorage(localStorage: LocalStorage): Promise<void> {
        const jsonBuffer = Buffer.from(JSON.stringify(localStorage), 'utf-8');
        await this.localStorageBlobClient.uploadData(jsonBuffer, {
            blobHTTPHeaders: {
                blobContentType: 'application/json'
            }
        });
    }
}
