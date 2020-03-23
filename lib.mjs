// import config from "./config.js";
import mask from "@trellisfw/masklink";

export class VDoc {
  vDoc;
  masks;

  constructor(vDoc) {
    this.vDoc = vDoc;
    this.masks = mask.findAllMaskPathsInResource(this.vDoc);
  }

  access(path) {
    let steps = path.split("/");
    if (steps[0] === "") {
      steps.shift();
    }
    let obj = this.vDoc;
    for (const step in steps) {
      if (obj[steps[step]]) {
        if (!mask.isMask(obj)) {
          obj = obj[steps[step]];
        } else {
          return {
            plo: steps.slice(step, steps.length).join("/"),
            res: obj
          };
        }
      } else {
        return {
          plo: steps.slice(step, steps.length).join("/"),
          res: undefined
        };
      }
    }
    return {
      plo: "",
      res: obj
    };
  }
}
