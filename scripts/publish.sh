#!/usr/bin/env bash

set -euo pipefail

publish::cargo() {
    cargo release --execute --no-confirm --no-tag
}

publish::npm() {
    npx changeset version

    if git diff --quiet && git diff --cached --quiet; then
        echo 'No version bumps to commit'
    else
        git add .
        git commit -m 'chore: version packages'
        git push origin HEAD:main
    fi

    npx changeset publish
}

usage() {
    cat <<EOF
Usage: ${BASH_SOURCE[0]} <SUITE>

Suite:
    all     Publish all packages (cargo and npm)
    cargo   Publish cargo packages
    npm     Publish npm packages
EOF
}

main() {
    local suite="${1:-all}"
    case "${suite}" in
        'all')
            publish::npm
            ;;
        'cargo')
            publish::cargo
            ;;
        'npm')
            publish::npm
            ;;
        *)
            usage
            ;;
    esac

}

main "${@}"
