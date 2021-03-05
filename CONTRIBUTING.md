# Contributing

Thank you for your interest in contributing to the project!

Contributions of all kinds are welcome including pull requests, issues, and reports of or links to repos using the project!

## Filing Issues

When submitting a bug report try to include a clear, minimal repro case along with the issue. More information means the problem can be fixed faster and better!

When submitting a feature request please include a well-defined use case and even better if you include code modeling how the new feature could be used with a proposed API!

Promote discussion! Let's talk about the change and discuss what the best, most flexible option might be.

## Developer setup

To develop and test changes to this library, make sure you have Node and NPM installed.
Check the supported versions in [the test configuration](./.github/workflows/node.js.yml).

In order to install dependencies, you will need `make` and a C++ compiler available.
On Debian or Ubuntu, run `sudo apt install build-essential`.

- To install dependencies, run `npm install`
- Once that has successfully completed, make sure all tests pass by running `npm test`. If any tests failed, you'll see red output indicating the number of failures. This may indicate a problem with your setup
- If you want to check the library's performance on different systems or after making changes, run `npm run benchmark`

## Pull Requests

Keep it simple! Code clean up and linting changes should be submitted as separate PRS from logic changes so the impact to the codebase is clear.

Keep PRs with logic changes to the essential modifications if possible -- people have to read it!

Open an issue for discussion first so we can have consensus on the change and be sure to reference the issue that the PR is addressing.

Keep commit messages descriptive. "Update" and "oops" doesn't tell anyone what happened there!

Don't modify existing commits when responding to PR comments. New commits make it easier to follow what changed.

## Code Style

Follow the `.editorconfig`, `.babelrc`, `.stylelintrc`, and `.htmlhintrc` style configurations included in the repo to keep the code looking consistent.

Try to keep code as clear as possible! Code for readability! For example longer, descriptive variable names are preferred to short ones. If a line of code includes a lot of nested statements (even just one or two) consider breaking the line up into multiple variables to improve the clarity of what's happening.

Include comments describing _why_ a change was made. If code was moved from one part of a function to another then tell what happened and why the change got made so it doesn't get moved back. Comments aren't just for others, they're for your future self, too!
