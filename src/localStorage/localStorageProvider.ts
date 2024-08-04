import { LocalStorage } from '@verdaccio/legacy-types';

/**
 * Interface for local storage providers
 */
export interface ILocalStorageProvider {
    /**
     * Gets LocalStorage, or undefined if it doesn't exist
     * On other errors, throw.
     */
    getLocalStorage(): Promise<LocalStorage | undefined>;

    /**
     * Saves LocalStorage
     */
    saveLocalStorage(localStorage: LocalStorage): Promise<void>;
}
