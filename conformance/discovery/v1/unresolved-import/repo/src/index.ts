import { gone } from "./gone.js";
import { types } from "./types.js";
import { data } from "./data.json";
import { fs } from "node:fs";
import { third } from "some-package";

export const used = [gone, types, data, fs, third];
