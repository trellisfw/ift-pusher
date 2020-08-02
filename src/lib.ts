/** @ts-ignore */
import { escape } from 'querystring';
/** @ts-ignore */
import ml from '@trellisfw/masklink';

export interface Result {
  pathLeftOver: string;
  result: any | undefined;
}

export function getValueOrMask(
  obj: any,
  path: string | string[],
): string | any {
  const { result } = getValue(obj, path);
  if (ml.isMask(result)) {
    return getVerificationQuery(result);
  }
  return result;
}

export function getValue(obj: any, path: string | string[]): Result {
  if (obj === undefined) {
    return {
      pathLeftOver: Array.isArray(path) ? path.join('.') : path,
      result: undefined,
    };
  }

  let steps: string[] = Array.isArray(path) ? path : path.split('.');
  let result = steps.reduce(
    (acc, step) => {
      if (acc.result === undefined || ml.isMask(acc.result)) {
        acc.pathLeftOver = acc.pathLeftOver.concat(`.${step}`);
        return acc;
      }

      acc.result = acc.result[step];
      return acc;
    },
    {
      pathLeftOver: '',
      result: obj,
    },
  );

  if (result.pathLeftOver.charAt(0) === '.') {
    result.pathLeftOver = result.pathLeftOver.substr(1);
  }
  return result;
}

export function getDisplayLocation(obj: any, path: string | string[]): string {
  const { result } = getValue(obj, path);
  if (ml.isMask(result)) {
    return getVerificationQuery(result);
  }
  return `${result.street_address},
      ${result.city},
      ${result.state},
      ${result.postal_code},
      ${result.country}`;
}

export function getDisplayScheme(obj: any): string {
  const { result } = getValue(obj, 'scheme');
  if (ml.isMask(result)) {
    return getVerificationQuery(result);
  }
  if (result.name === 'SQFI') {
    if (result.edition === '8.0') {
      return 'SQF - SQF Code 8th Edition';
    } else if (result.edition === '7.0') {
      return 'SQF - SQF Code 7th Edition';
    }
  }
  return '';
}

function getVerificationQuery(mask: any): string {
  if (!mask) {
    return '';
  }
  if (mask['trellis-mask']) {
    mask = mask['trellis-mask'];
  }
  return `https://trellisfw.github.io/reagan?trellis-mask=${escape(
    JSON.stringify(mask),
  )}`;
}
