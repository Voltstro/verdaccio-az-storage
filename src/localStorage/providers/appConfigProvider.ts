import { LocalStorage, Logger } from '@verdaccio/legacy-types';
import { AppConfigurationClient } from '@azure/app-configuration';
import { ILocalStorageProvider } from '../localStorageProvider';
import { AzureStoragePluginConfig } from '../../azureStoragePluginConfig';

/**
 * ILocalStorageProvider that uses Azure App Configuration
 */
export class AppConfigLocalStorageProvider implements ILocalStorageProvider {
    private readonly logger: Logger;
    private readonly client: AppConfigurationClient;
    private readonly keyName: string;

    constructor(logger: Logger, connectionString: string, config: AzureStoragePluginConfig, ) {
        this.logger = logger;
        this.keyName = config.appConfigKeyName ?? 'verdaccio-db';
        this.client = new AppConfigurationClient(connectionString);
    }
    
    public async getLocalStorage(): Promise<LocalStorage | undefined> {
        try {
            const setting = await this.client.getConfigurationSetting({
                key: this.keyName
            }, {});
    
            const value = setting.value;
            if(value) {
                return JSON.parse(value) as LocalStorage;
            }
        } catch(ex) {
            //404 error just means that the key doesn't exist
            if(ex instanceof Error && 'statusCode' in ex && ex.statusCode !== 404) {
                throw ex;
            }
        }

        return undefined;
    }

    public async saveLocalStorage(localStorage: LocalStorage): Promise<void> {
        await this.client.setConfigurationSetting({
            key: this.keyName,
            value: JSON.stringify(localStorage),
            contentType: 'application/json'
        });
    }
}
