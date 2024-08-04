import { Config } from '@verdaccio/legacy-types';

export interface AzureStoragePluginConfig extends Config {
    /**
     * Connection string for the Azure storage account
     */
    connectionString: string;

    /**
     * Name of the container inside of the storage account
     */
    containerName: string;

    /**
     * Where to store the packages inside of the container
     * @default 'packages'
     */
    packagesDir: string;

    /**
     * Cache control time (in seconds) for the package data (package.json file)
     */
    cachePackageDataTime: number;

    /**
     * Cache control time (in seconds) for the package it self (tar file)
     */
    cachePackageTime: number;

    /**
     * Connection string for the Azure app configuration.
     * (Optional)
     */
    appConfigConnectionString?: string;

    /**
     * Key name for the value store in app configuration.
     * (Optional)
     * @default 'verdaccio-db'
     */
    appConfigKeyName?: string;
}
