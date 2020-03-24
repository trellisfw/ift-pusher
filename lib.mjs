import {escape} from "querystring";
import config from "./config.js";
import ml from "@trellisfw/masklink";

const TRELLIS_URL = config.get("trellis_url");

export class VDoc {
  vDoc;
  masks;

  constructor(vDoc) {
    this.vDoc = vDoc;
    this.masks = ml.findAllMaskPathsInResource(this.vDoc);
  }

  access(path) {
    let steps = path.split("/");
    if (steps[0] === "") {
      steps.shift();
    }
    let obj = this.vDoc;
    for (const step in steps) {
      if (obj[steps[step]]) {
        if (!ml.isMask(obj)) {
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

  /*
   * This function does not other formatting of the result
   * If additional formatting is required, the result will have to be further
   * processed manually
   */
  getFieldValue(path) {
    const {plo, res} = this.access(path);
    if (plo === "") {
      return res;
    }
    return undefined;
  }

  getDisplayLocation(path) {
    const {res} = this.access(path);
    if (ml.isMask(res)) {
      return getVerificationQuery(res);
    }
    return `${res.street_address},
        ${res.city},
        ${res.state},
        ${res.postal_code},
        ${res.country}`;
  }

  getDisplayScheme() {
    const {res} = this.access("/scheme");
    // not sure why this would ever happen...
    if (ml.isMask(res)) {
      return getVerificationQuery(res);
    }
    if (res.name === "SQFI") {
      if (res.edition === "8.0") {
        return "SQF - SQF Code 8th Edition";
      } else if (res.edition === "7.0") {
        return "SQF - SQF Code 7th Edition";
      }
    }
    return "";
  }
}

function getVerificationQuery(mask) {
  if (!mask) {
    return "";
  }
  return `https://trellisfw.github.io/reagan?trellis-mask=${escape(
    JSON.stringify(mask["trellis-mask"])
  )}`;
}
