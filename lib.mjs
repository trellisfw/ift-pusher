// import config from "./config.js";
import mask from "@trellisfw/masklink";

// const TRELLIS_URL = "localhost";
// const TRELLIS_URL = config.get("trellis_url");

import TEST_AUDIT from "./auditMasked.js";

// const test = {
//   one1: {
//     "trellis-mask": {
//       one2: "one"
//     }
//   },
//   two1: {
//     two2: {
//       "trellis-mask": {
//         two3: "two3"
//       }
//     }
//   }
// };

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

  /*
   * This function does not other formatting of the result
   * If additional formatting is required, the result will have to be further
   * processed manually
   */
  getFieldValue(path) {
    const { plo, res } = this.access(path);
    if (plo === "") {
      return res;
    }
    return undefined;
  }

  getDisplayLocation(path) {
    const { res } = this.access(path);
    if (mask.isMask(res)) {
      return getVerificationURL(res);
    }
    return `${res.street_address},
        ${res.city},
        ${res.state},
        ${res.postal_code},
        ${res.country}`;
  }

  getDisplayScheme() {
    const { res } = this.access("/scheme");
    // not sure why this would ever happen...
    if (mask.isMask(res)) {
      return getVerificationURL(res);
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

(() => {
  const v1 = new VDoc(TEST_AUDIT);
  console.log(v1.masks);
  if (v1.masks) {
    v1.masks.forEach(mask => {
      console.log(mask);
      console.log(v1.access(mask));
    });
  }
  console.log(v1.access("one1/three/four1"));
})();
