#!/bin/bash

#set -x  # UNCOMMENT TO TRACE DURING BUILD

pwd

ENV_FILE="./.devcontainer/.env"
RED='\e[0;31m'
YELLOW='\e[0;33m'
GREEN='\e[0;32m'
NC='\e[0m'  # No Color

exit_code=0

# Check if .env file exists
if [ ! -f "${ENV_FILE}" ]; then
    printf "${YELLOW}.env file does not exist. Please create it if you wish to copy local AZCLI context.${NC}\n"
    exit
else
    printf "${GREEN}.env file found. Loading local AZCLI context into devcontainer.${NC}\n"
    source "${ENV_FILE}"
fi

error() {
    printf "\n${RED}Error:${NC} %s\n" "${1}"
    printf "${RED}Please address this issue before proceeding.${NC}\n"
    exit_code=1
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Navigate to the src directory
src_dir="${script_dir}/../src"

# Check if Azure CLI (az) is installed
if ! command -v az &> /dev/null; then
    error "Azure CLI (az) is not installed! Please install it from https://learn.microsoft.com/en-us/cli/azure/install-azure-cli-linux?pivots=apt#install-azure-cli."
fi
printf "${GREEN}Azure CLI (az) is installed! ${NC}\n"
AZ="$(which az)"

# Check Azure context
exists=$($AZ account list --query "[?id==\`${expected_az_context}\`].id" -o tsv)
if [[ "${expected_az_context}" != "${exists}" ]]; then
    error "Azure Subscriptions not listed in available AZ contexts: ${expected_az_context}."
else

    current_az_context="$($AZ account show --query id -o tsv)"

    printf "${GREEN}Azure Subscription available within AZ contexts.${NC}\n"
    if [ "$current_az_context" != "$expected_az_context" ]; then
        $AZ account set -s "${expected_az_context}"
    fi

    cp -RL ~/.azure "${script_dir}"  # R:Recursive L:DereferenceSymlink

    if [ "$current_az_context" != "$expected_az_context" ]; then
        $AZ account set -s "${current_az_context}"
    fi
fi

exit ${exit_code}
