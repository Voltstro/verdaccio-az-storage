import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient, type ContainerClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import type { Logger } from '@verdaccio/types';
import { LOGGER_PREFIX } from './constants';

export function setupConnectionStringAuth(
    logger: Logger,
    connectionString: string,
    containerName: string,
): { blobClient: BlobServiceClient; containerClient: ContainerClient } {
    if (!connectionString) {
        logger.error(`${LOGGER_PREFIX}: Connection string is required!`);
        throw new Error('Connection string is required!');
    }

    try {
        const blobClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerClient = blobClient.getContainerClient(containerName);
        return { blobClient, containerClient };
    } catch (ex) {
        logger.error({ ex }, `${LOGGER_PREFIX}: Error creating Azure blob client! @{ex}`);
        throw ex;
    }
}

export function setupDefaultAzureCredentialAuth(
    logger: Logger,
    accountName: string,
    containerName: string,
    accountDomain: string,
): { blobClient: BlobServiceClient; containerClient: ContainerClient } {
    try {
        const credential = new DefaultAzureCredential();
        const blobClient = new BlobServiceClient(`https://${accountName}.${accountDomain}`, credential);
        const containerClient = blobClient.getContainerClient(containerName);
        return { blobClient, containerClient };
    } catch (ex) {
        logger.error({ ex }, `${LOGGER_PREFIX}: Error creating Azure blob client with Azure CLI authentication! @{ex}`);
        throw ex;
    }
}

export function setupStorageSharedKeyCredential(
    logger: Logger,
    accountName: string,
    accountKey: string,
    containerName: string,
    accountDomain: string,
): { blobClient: BlobServiceClient; containerClient: ContainerClient } {
    try {
        const credential = new StorageSharedKeyCredential(accountName, accountKey);
        const blobClient = new BlobServiceClient(`https://${accountName}.${accountDomain}`, credential);
        const containerClient = blobClient.getContainerClient(containerName);
        return { blobClient, containerClient };
    } catch (ex) {
        logger.error({ ex }, `${LOGGER_PREFIX}: Error creating Azure blob client with managed identity! @{ex}`);
        throw ex;
    }
}
