import { LocalStorage, Logger } from '@verdaccio/legacy-types';
import { AppConfigurationClient } from '@azure/app-configuration';
import { ILocalStorageProvider } from '../localStorageProvider';

/**
 * ILocalStorageProvider that uses Azure App Configuration
 */
export class AppConfigLocalStorageProvider implements ILocalStorageProvider {
    private readonly logger: Logger;
    private readonly client: AppConfigurationClient;

    constructor(logger: Logger, connectionString: string) {
        this.logger = logger;
        this.client = new AppConfigurationClient(connectionString);
    }
    
    public async getLocalStorage(): Promise<LocalStorage | undefined> {
        try {
            const setting = await this.client.getConfigurationSetting({
                key: 'verdaccio-db'
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
            key: 'verdaccio-db',
            value: JSON.stringify(localStorage),
            contentType: 'application/json'
        });
    }
}
