# Change Log

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/).

# [0.0.6] - 2021-03-41

## Changes
- **generateNewId** uses crypto secure random id generation

# [0.0.5] - 2021-03-11

## Added

- Added **wasCancelled** option to push and pull, in order
  to provide a way from cancelling the merge of the server
  response from client code if not desirable anymore -
  for instance logging out

# [0.0.4] - 2021-03-10

## Fixes

- Fixed error when pushing changes to unchanged server resulting
  in failed merge.

# [0.0.3] - 2021-03-08

## Added

- Simple push, pull and clone synchronization functions

# [0.0.1] - 2021-03-01

Initial package publication
