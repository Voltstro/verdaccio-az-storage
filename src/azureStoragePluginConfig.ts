import { Config } from '@verdaccio/legacy-types';

export interface AzureStoragePluginConfig extends Config {
    connectionString: string;
    containerName: string
}
