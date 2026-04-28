#!/usr/bin/env node
import { Command } from 'commander';

import { description, name, version } from '../../package.json';

import addCacheCommand from './cache';
import addTranslateCommand from './translate';

const program = new Command().name(name).description(description).version(version);

addTranslateCommand(program);
addCacheCommand(program);

program.parse(process.argv);
