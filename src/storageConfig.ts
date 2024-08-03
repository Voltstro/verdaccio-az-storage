import { Config } from '@verdaccio/legacy-types';

export interface AzureBlobConfig extends Config {
    connectionString: string;
    containerName: string
}