# verdaccio-az-storage

[Azure Storage](https://learn.microsoft.com/en-us/azure/storage/common/storage-introduction) plugin for [Verdaccio 5](https://verdaccio.org/).

## Features

- Stores packages and its data in an Azure Storage container
- Cache control settings
- Optionally, store verdaccio's database in Azure App Configuration

## Getting Started

### Prerequisites

- An Azure Storage account with a container
- Verdaccio 5

### Install

Install like any other verdaccio plugin.

```bash
npm install verdaccio-az-storage
```

### Configuration

To use this plugin, you will need to add the plugin to your verdaccio's config store option.

```yaml
store:
  az-storage:
    # (Required) Connection string for the Azure storage account, can also be set by AZ_STORAGE_CONNECTION_STRING environment variable
    connectionString: 

    # (Required) Name of the container inside of the storage account
    containerName: example

    # (Optional, default 'packages') Directory in the container to store the packages in
    packagesDir: packages

    # (Optional) Cache control time (in seconds) for the package data (package.json file)
    cachePackageDataTime: 

    # (Optional) Cache control time (in seconds) for the package it self (tar file)
    cachePackageTime: 

    # (Optional) Connection string for the Azure app configuration, can also be set by AZ_STORAGE_APP_CONFIG_CONNECTION_STRING
    appConfigConnectionString: 

    # (Optional, default 'verdaccio-db') Key name for the value store in app configuration
    appConfigKeyName: verdaccio-db

```

## Authors

* **Voltstro** - *Initial work* - [Voltstro](https://github.com/Voltstro)

## Thanks

- [verdaccio-aws-s3-storage](https://www.npmjs.com/package/verdaccio-aws-s3-storage) - Provided base example on developing a storage plugin for Verdaccio
