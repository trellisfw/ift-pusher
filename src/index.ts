#!/usr/bin/env node

import { OADAClient, Json } from '@oada/client';
import _debug from 'debug';
import fetch from 'node-fetch';
import moment from 'moment';
import FormData from 'form-data';
import { getValueOrMask, getDisplayLocation, getDisplayScheme } from './lib';
// import type {Response as FetchResponse} from 'node-fetch';
import { Service, WorkerFunction } from '@oada/jobs';
import { assert as assertSync } from '@oada/types/trellis/service/ift-pusher/sync';
import { assert as assertResource } from '@oada/types/oada/resource';
import Audit, { is as isAudit } from '@oada/types/trellis/audit/generic/v1';
import Coi, { is as isCoi } from '@oada/types/trellis/certificate/generic/v1';

import config from './config';

const debug = _debug('ift-pusher:info');
const info = _debug('ift-pusher:info');
const trace = _debug('ift-pusher:trace');
const error = _debug('ift-pusher:error');

const IBM_IAM_APIKEY = config.get('ibm_iam_apikey');
const IBM_IAM_TOKEN_URL = config.get('ibm_iam_token_url');
const IBM_FT_TOKEN_URL = config.get('ibm_ft_token_url');
const IBM_FT_BASE_URL = config.get('ibm_ft_base_url');

const TRELLIS_URL = config.get('trellis_url');
const TRELLIS_TOKEN = config.get('trellis_token');

type AccessToken = string;
type Document = Audit | Coi;

interface PDF {
  filename: string;
  data: ArrayBuffer;
}

interface CustomProperties {
  name: string;
  value: string;
  format?: string;
}

const iftSync: WorkerFunction = async (job, context): Promise<Json> => {
  assertSync(job);
  const resourceId = job?.config?.resourceId || '';
  info(`Pushing resource ${resourceId} to IBM Food Trust`);
  debug(`Get IFT access token`);
  // TODO: Reuse old ones somehow
  const accessToken = await getIFTAccessToken();

  debug(`Get vDoc from Trellis: ${resourceId}`);
  const vDoc: any = await context.oada
    .get({ path: resourceId })
    .then((r) => r.data);

  debug('Get PDF from Trellis');
  const pdf: PDF = await getPDF(vDoc, context.oada);

  debug('Resource:', resourceId);
  debug('Creating IFT audit');
  const iftId = await createIFTDocument(accessToken, vDoc, pdf);

  return { iftId };
};

function formUrlencoded(data: any): string {
  return Object.keys(data)
    .map((key) => `${encodeURIComponent(key)}=${data[key]}`)
    .join('&');
}

async function getIFTAccessToken(): Promise<string> {
  // TODO: These tokens are good until they expire (expire data is in a key of
  // `iamAccessToken`). We should reuse until they expire.
  // Fetch the IBM IAM access token
  let iamAccessToken;
  try {
    iamAccessToken = await fetch(IBM_IAM_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: formUrlencoded({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey: IBM_IAM_APIKEY,
      }),
    }).then((r) => r.json());
  } catch (e) {
    error('%O', e);
    throw 'Failed to get IBM IAM access token';
  }

  // Trade for a food trust "service token"
  try {
    return fetch(IBM_FT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(iamAccessToken),
    })
      .then((r) => r.json())
      .then((d: any) => d.onboarding_token);
  } catch (e) {
    error('%O', e);
    throw 'Failed to trade IBM IAM access token for a food trust service token';
  }
}

async function getPDF(vDoc: any, oada: OADAClient): Promise<PDF> {
  trace('Fetching the PDF filename from Trellis');
  const filename = await oada
    .get({ path: `/${vDoc._id}/_meta/vdoc/pdf/_meta/` })
    // TODO: Requesting `filename` directly results in a hang
    .then((r) => {
      const data = r.data as any;
      return (data?.filename || '') as string;
    });

  trace('Fetching PDF from Trellis');
  let binary;
  try {
    binary = await fetch(`${TRELLIS_URL}/${vDoc._id}/_meta/vdoc/pdf/`, {
      method: 'get',
      headers: {
        Authorization: `Bearer ${TRELLIS_TOKEN}`,
      },
    });
    if (!binary.ok) {
      throw new Error('Failed to fetch PDF from Trellis');
    }
  } catch (e) {
    error('%O', e);
    throw new Error('Failed to fetch PDF from Trellis');
  }

  return {
    filename,
    data: await binary.buffer(),
  };
}

function createAuditForm(audit: any, pdf: PDF): FormData {
  console.log(audit);
  let auditors = getValueOrMask(audit, 'certifying_body.auditors');
  if (Array.isArray(auditors)) {
    auditors = auditors.map((a) => `${a.FName} ${a.LName}`).join(', ');
  }

  const formData = new FormData();
  formData.append('content', pdf.data, {
    contentType: 'application/pdf',
    // name: 'content',
    filename: pdf.filename,
  });
  formData.append(
    'properties',
    JSON.stringify({
      documentType: 'SQF',
      documentTitle: `${getValueOrMask(
        audit,
        'scheme.name',
      )} Audit - ${getValueOrMask(audit, 'organization.name')}`,
      expiryDate: moment(
        getValueOrMask(audit, 'certificate_validity_period.end'),
        'MM/DD/YYYY',
      ).format('YYYY-MM-DD'),
      issueDate: moment(
        getValueOrMask(audit, 'certificate_validity_period.start'),
        'MM/DD/YYYY',
      ).format('YYYY-MM-DD'),
      customProperties: [
        {
          name: '(( c )) Scheme',
          value: getDisplayScheme(audit),
        },
        {
          name: '(( c )) Score',
          value: `${getValueOrMask(
            audit,
            'score.final.value',
          )} ${getValueOrMask(audit, 'score.final.units')}`,
        },
        {
          name: '(( c )) Rating',
          value: getValueOrMask(audit, 'score.rating'),
        },
        {
          name: '(( c )) Certification id',
          value: getValueOrMask(audit, 'certificationid.id'),
        },
        {
          name: '(( c )) Audit id',
          value: getValueOrMask(audit, 'auditid.id'),
        },
        {
          name: '(( c )) Organization',
          value: getValueOrMask(audit, 'organization.name'),
        },
        {
          name: '(( c )) Organization location',
          value: getDisplayLocation(audit, 'organization.location'),
        },
        {
          name: '(( c )) Products',
          value: getValueOrMask(audit, 'scope.products_observed')
            .map((p: any) => p.name)
            .join(', '),
        },
        {
          name: '(( c )) Audit date',
          value: moment(
            getValueOrMask(
              audit,
              'conditions_during_audit.operation_observed_date.start',
            ),
          ).format('YYYY-MM-DD'),
          format: 'date',
        },
        {
          name: '(( c )) Certification body',
          value: getValueOrMask(audit, 'certifying_body.name'),
        },
        {
          name: '(( c )) Auditors',
          value: auditors,
        },
      ],
    }),
  );

  return formData;
}

function createCoiForm(coi: any, pdf: PDF): FormData {
  info('Posting coi virtual document to IBM Food Trust');

  let customProperties: CustomProperties[] = [
    {
      name: '(( c )) Certificate number',
      value: getValueOrMask(coi, 'certificate.certnum'),
    },
    {
      name: '(( c )) Producer',
      value: getValueOrMask(coi, 'producer.name'),
    },
    {
      name: '(( c )) Producer location',
      value: getDisplayLocation(coi, 'producer.location'),
    },
    {
      name: '(( c )) Insured',
      value: getValueOrMask(coi, 'insured.name'),
    },
    {
      name: '(( c )) Insured location',
      value: getDisplayLocation(coi, 'insured.location'),
    },
    {
      name: '(( c )) Holder',
      value: getValueOrMask(coi, 'holder.name'),
    },
    {
      name: '(( c )) Holder location',
      value: getDisplayLocation(coi, 'holder.location'),
    },
  ];

  const policies = getValueOrMask(coi, 'policies');
  Object.keys(policies).forEach((number, i) => {
    const p = policies[number];

    customProperties.push({
      name: `(( c )) Policy ${i + 1} number`,
      value: p.number,
    });
    customProperties.push({
      name: `(( c )) Policy ${i + 1} effective`,
      value: moment(p.effective_date).format('YYYY-MM-DD'),
      format: 'date',
    });
    customProperties.push({
      name: `(( c )) Policy ${i + 1} expire`,
      value: moment(p.expire_date).format('YYYY-MM-DD'),
      format: 'date',
    });
  });

  const formData = new FormData();
  formData.append('content', pdf.data, {
    contentType: 'application/pdf',
    // name: 'content',
    filename: pdf.filename,
  });
  formData.append(
    'properties',
    JSON.stringify({
      documentType: 'Generic Document',
      documentTitle: `Certificate of Insurance - ${getValueOrMask(
        coi,
        'holder.name',
      ).trim()}`,
      issueDate: moment(getValueOrMask(coi, 'certificate.docdate')).format(
        'YYYY-MM-DD',
      ),
      customProperties,
    }),
  );

  return formData;
}

async function createIFTDocument(
  accessToken: AccessToken,
  vDoc: Document,
  pdf: PDF,
): Promise<string> {
  let formData: FormData;
  if (isAudit(vDoc)) {
    formData = createAuditForm(vDoc, pdf);
  } else if (isCoi(vDoc)) {
    formData = createCoiForm(vDoc, pdf);
  } else {
    throw new Error('Document type unrecognized');
  }

  info('Posting document to IFT');
  let r = await fetch(`${IBM_FT_BASE_URL}/documents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: formData,
  }).then((r) => {
    if (!r.ok) {
      throw new Error('Failed to upload document to IFT');
    }
    return r.json();
  });

  if (!r.id) {
    error('%O', r);
    throw new Error('IFT post failed!');
  }

  return r.id;
}

const service = new Service('ift-pusher', TRELLIS_URL, TRELLIS_TOKEN, 10);
service.on('sync', 10 * 1000, iftSync);

(async () => {
  trace('Starting trellis IFT pusher');
  try {
    await service.start();
  } catch (e) {
    error('%O', e);
  }
})();
