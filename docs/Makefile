# Makefile for FAST Documentation
#
# This Makefile provides targets for managing the MkDocs-based documentation site.
# The site uses Material theme, mkdocstrings for API docs, and awesome-nav for
# automatic navigation generation from directory structure.

# Declare phony targets (targets that don't represent files)
.PHONY: install docs build deploy clean

# install: Install all documentation dependencies
# 
# Installs Python packages required to build and serve the documentation:
# - mkdocs: Static site generator
# - mkdocs-material: Material Design theme
# - mkdocs-awesome-nav: Automatic navigation from directory structure
# - mkdocstrings-python: Auto-generate API docs from Python docstrings
#
# Usage: make install
install:
	pip install -r requirements.txt

# docs: Start local development server with live reload
#
# Starts MkDocs development server on http://127.0.0.1:8000 with automatic
# browser reload when source files change. Useful for iterative development.
#
# The --livereload flag watches for changes to:
# - Markdown files in docs/
# - mkdocs.yml configuration
# - Python source files (for API docs)
#
# Usage: make docs
docs:
	mkdocs serve --livereload

# build: Build static site for production
#
# Generates the complete static site in the site/ directory. This validates:
# - All Markdown files compile correctly
# - Internal links resolve properly
# - API documentation generates without errors
# - Theme assets are bundled correctly
#
# The site/ directory can be served by any static web server.
#
# Usage: make build
build:
	mkdocs build

# deploy: Deploy site to GitHub Pages
#
# Builds the site and deploys it to the gh-pages branch using MkDocs' built-in
# GitHub Pages deployment. This command:
# 1. Builds the site (equivalent to 'make build')
# 2. Force-pushes the site/ directory contents to the gh-pages branch
# 3. GitHub Pages automatically serves the updated site
#
# Note: Requires push access to the repository and proper Git configuration.
# In CI/CD, this is typically handled by GitHub Actions instead.
#
# Usage: make deploy
deploy:
	@echo "Building and deploying to GitHub Pages..."
	mkdocs gh-deploy --force

# clean: Remove generated site files
#
# Removes the site/ directory containing the built static site. Useful for
# ensuring a clean build or freeing disk space.
#
# Usage: make clean
clean:
	rm -rf site/