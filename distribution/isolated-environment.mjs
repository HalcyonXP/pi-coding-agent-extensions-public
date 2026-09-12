// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import {mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
const write=(path,value)=>writeFileSync(path,value,{flag:"wx"});
/** OS execution variables only. Establish this environment before importing any SDK. */
export function isolatedEnvironment(home, inherited = process.env) {
  mkdirSync(home);
  for (const name of ["tmp", "roaming", "local", "agent"]) mkdirSync(join(home, name));
  for (const name of ["gitconfig", "npm-user", "npm-global"]) write(join(home, name), "");
  const env = {
    HOME: home, USERPROFILE: home, APPDATA: join(home, "roaming"), LOCALAPPDATA: join(home, "local"),
    TEMP: join(home, "tmp"), TMP: join(home, "tmp"), PI_CODING_AGENT_DIR: join(home, "agent"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    npm_config_userconfig: join(home, "npm-user"), npm_config_globalconfig: join(home, "npm-global"),
    PI_OFFLINE: "1", PI_TELEMETRY: "0",
  };
  for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "ComSpec", "PATHEXT"]) {
    if (inherited[key] !== undefined) env[key] = inherited[key];
  }
  return env;
}
