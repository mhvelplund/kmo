import { PeprModule } from "pepr";
import cfg from "./package.json";
import { Kmo } from "./src/capability";

new PeprModule(cfg, [Kmo]);
