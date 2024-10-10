UPSTREAM_GIT_URL = git@github.com:buildkite/charts.git
CHARTS_URL = https://buildkite.github.io/charts
CT_IMAGE = quay.io/helmpack/chart-testing:v3.7.0
COMMIT = $(shell git rev-parse --short HEAD)

.PHONY: lint shellcheck clean build release

# Lints the chart changes against origin/master
lint:
	git fetch origin master && \
		docker run \
			--volume "${PWD}:/src" \
			--workdir /src \
			--rm \
			"${CT_IMAGE}" \
			ct lint --config test/ct.yaml

# Runs shellcheck over any shell files
shellcheck:
	docker run \
		--volume "${PWD}:/src" \
		--workdir /src \
		--rm \
		koalaman/shellcheck-alpine \
		sh -c "shellcheck -x **/*.sh"

clean:
	rm -rf dist-repo

dist-repo:
	git clone --quiet --single-branch -b gh-pages "${UPSTREAM_GIT_URL}" dist-repo

# Build all Helm packages into dist-repo and regenerate the chart index
build: dist-repo
	cd package && \
		docker-compose build && \
		docker-compose run --rm package package.sh "${CHARTS_URL}" dist-repo && \
		cd ../dist-repo && \
		echo "--- Diff" && \
		git diff --stat

# Commit and push the chart index
release:
	cd dist-repo && \
		git add *.tgz index.yaml && \
		git commit --message "Update to buildkite/charts@${COMMIT}" && \
		git push https://dummy:$${GH_TOKEN}@github.com/buildkite/charts.git gh-pages
