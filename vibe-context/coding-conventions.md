# Code Conventions
* Always use explicit strong types where possible in method signatures and return types.
* Prefer to use named parameters over positional parameters when making method calls.
* Do not create `__init__.py` files unless explicitly asked to do so.
* Always prefer classes with `@staticmethod`'s over plain methods. 
* This project uses [Google Docstring Style](https://github.com/google/styleguide/blob/gh-pages/pyguide.md#38-comments-and-docstrings)
* Add this header at the top of each file:
``` python
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
```