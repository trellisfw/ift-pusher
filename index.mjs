import debug from "debug";
import fetch from "node-fetch";
import { JobQueue } from "@oada/oada-jobs";
import Promise from "bluebird";
import moment from "moment";
import FormData from "form-data";
import { VDoc } from "./lib.mjs";

import config from "./config.js";

const info = debug("ift-pusher:info");
const trace = debug("ift-pusher:trace");
const error = debug("ift-pusher:error");

const IBM_IAM_APIKEY = config.get("ibm_iam_apikey");
const IBM_IAM_TOKEN_URL = config.get("ibm_iam_token_url");
const IBM_FT_TOKEN_URL = config.get("ibm_ft_token_url");
const IBM_FT_BASE_URL = config.get("ibm_ft_base_url");

const TRELLIS_URL = config.get("trellis_url");
const TRELLIS_TOKEN = config.get("trellis_token");

const service = new JobQueue("ift-pusher", iftSync, {
  concurrency: 1,
  domain: TRELLIS_URL,
  token: TRELLIS_TOKEN
});

function formUrlencoded(data) {
  return Object.keys(data)
    .map(key => `${encodeURIComponent(key)}=${data[key]}`)
    .join("&");
}

async function getIFTAccessToken() {
  // TODO: These tokens are good until they expire (expire data is in a key of
  // `iamAccessToken`). We should reuse until they expire.
  // Fetch the IBM IAM access token
  let iamAccessToken;
  try {
    iamAccessToken = await fetch(IBM_IAM_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: formUrlencoded({
        grant_type: "urn:ibm:params:oauth:grant-type:apikey",
        apikey: IBM_IAM_APIKEY
      })
    }).then(r => r.json());
  } catch (e) {
    error("%O", e);
    throw "Failed to get IBM IAM access token";
  }

  // Trade for a food trust "service token"
  try {
    return fetch(IBM_FT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(iamAccessToken)
    })
      .then(r => r.json())
      .then(d => d.onboarding_token);
  } catch (e) {
    error("%O", e);
    throw "Failed to trade IBM IAM access token for a food trust service token";
  }
}

async function iftSync(resource_id, task, conn) {
  info(`Pushing ${resource_id} to IBM Food Trust`);
  debug(`Get IFT access token`);
  // TOOD: Reuse old ones somehow
  const access_token = await getIFTAccessToken();

  debug("Get vDoc from Trellis");
  const vDoc = await conn
    .get({ path: `/resources/${resource_id}` })
    .then(r => r.data);

  debug("Get PDF from Trellis");
  const pdf = await getPDF(vDoc, conn);

  if (vDoc.audits) {
    task.audits = {};
    await Promise.map(Object.keys(vDoc.audits), async auditId => {
      debug("Audit:", auditId);
      const audit = await conn
        .get({ path: `/resources/${resource_id}/audits/${auditId}` })
        .then(r => r.data)
        .then(doc => new VDoc(doc));

      debug("Creating IFT audit");
      const iftId = await createIFTAudit(access_token, audit, pdf);

      // Update results
      task.audits[auditId] = { iftId };
    });
  }

  if (vDoc.cois) {
    task.cois = {};
    await Promise.map(Object.keys(vDoc.cois), async coiId => {
      debug("Coi:", coiId);
      const coi = await conn
        .get({ path: `/resources/${resource_id}/cois/${coiId}` })
        .then(r => r.data)
        .then(doc => new VDoc(doc));

      debug("Creating IFT coi");
      const iftId = await createIFTCoi(access_token, coi, pdf);

      // Update results
      task.cois[coiId] = { iftId };
    });
  }

  return task;
}

async function getPDF(vDoc, conn) {
  trace("Fetching the PDF filename from Trellis");
  const filename = await conn
    .get({ path: `/${vDoc._id}/pdf/_meta` })
    .then(r => r.data.filename); // TODO: Requesting `filename` directly results in a hang

  trace("Fetching PDF from Trellis");
  let binary;
  try {
    binary = await fetch(`${TRELLIS_URL}/${vDoc._id}/pdf`, {
      method: "get",
      headers: {
        Authorization: `Bearer ${TRELLIS_TOKEN}`
      }
    });
  } catch (e) {
    error("%O", e);
    throw "Could not fetch PDF from Trellis";
  }

  return {
    filename,
    data: await binary.buffer()
  };
}

async function createIFTAudit(access_token, audit, pdf) {
  console.log(audit);
  const auditors = audit
    .getFieldValue("/certifying_body/auditors")
    .map(a => `${a.FName} ${a.LName}`)
    .join(", ");

  const formData = new FormData();
  formData.append("content", pdf.data, {
    contentType: "application/pdf",
    name: "content",
    filename: pdf.filename
  });
  formData.append(
    "properties",
    JSON.stringify({
      documentType: "SQF",
      documentTitle: `${audit.getFieldValue(
        "/scheme/name"
      )} Audit - ${audit.getFieldValue("/organization/name")}`,
      expiryDate: moment(
        audit.getFieldValue("/certificate_validity_period/end"),
        "MM/DD/YYYY"
      ).format("YYYY-MM-DD"),
      issueDate: moment(
        audit.getFieldValue("/certificate_validity_period/start"),
        "MM/DD/YYYY"
      ).format("YYYY-MM-DD"),
      customProperties: [
        {
          name: "(( c )) Scheme",
          value: audit.getDisplayScheme()
        },
        {
          name: "(( c )) Score",
          value: `${audit.getFieldValue(
            "/score/final/value"
          )} ${audit.getFieldValue("/score/final/units")}`
        },
        {
          name: "(( c )) Rating",
          value: audit.getFieldValue("/score/rating")
        },
        {
          name: "(( c )) Certification id",
          value: audit.getFieldValue("/certificationid/id")
        },
        {
          name: "(( c )) Audit id",
          value: audit.getFieldValue("/auditid/id")
        },
        {
          name: "(( c )) Organization",
          value: audit.getFieldValue("/organization/name")
        },
        {
          name: "(( c )) Organization location",
          value: audit.getDisplayLocation("/organization/location")
        },
        {
          name: "(( c )) Products",
          value: audit
            .getFieldValue("/scope/products_observed")
            .map(p => p.name)
            .join(", ")
        },
        {
          name: "(( c )) Audit date",
          value: moment(
            audit.getFieldValue(
              "/conditions_during_audit/operation_observed_date/start"
            )
          ).format("YYYY-MM-DD"),
          format: "date"
        },
        {
          name: "(( c )) Certification body",
          value: audit.getFieldValue("/certifying_body/name")
        },
        {
          name: "(( c )) Auditors",
          value: auditors
        }
      ]
    })
  );

  info("Posting audit to IFT");
  let r = await fetch(`${IBM_FT_BASE_URL}/documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`
    },
    body: formData
  }).then(r => r.json());

  if (!r.id) {
    error("%O", r);
    throw "IFT post failed!";
  }

  return r.id;
}

async function createIFTCoi(access_token, coi, pdf) {
  info("Posting coi virtual document to IBM Food Trust");

  let customProperties = [
    {
      name: "(( c )) Certificate number",
      value: coi.getFieldValue("/certificate/certnum")
    },
    {
      name: "(( c )) Producer",
      value: coi.getFieldValue("/producer/name")
    },
    {
      name: "(( c )) Producer location",
      value: coi.getDisplayLocation("/producer/location")
    },
    {
      name: "(( c )) Insured",
      value: coi.getFieldValue("/insured/name")
    },
    {
      name: "(( c )) Insured location",
      value: coi.getDisplayLocation("/insured/location")
    },
    {
      name: "(( c )) Holder",
      value: coi.getFieldValue("/holder/name")
    },
    {
      name: "(( c )) Holder location",
      value: coi.getDisplayLocation("/holder/location")
    }
  ];

  const policies = coi.getFieldValue("/policies");
  Object.keys(policies).forEach((number, i) => {
    const p = policies[number];

    customProperties.push({
      name: `(( c )) Policy ${i + 1} number`,
      value: p.number
    });
    customProperties.push({
      name: `(( c )) Policy ${i + 1} effective`,
      value: moment(p.effective_date).format("YYYY-MM-DD"),
      format: "date"
    });
    customProperties.push({
      name: `(( c )) Policy ${i + 1} expire`,
      value: moment(p.expire_date).format("YYYY-MM-DD"),
      format: "date"
    });
  });

  const formData = new FormData();
  formData.append("content", pdf.data, {
    contentType: "application/pdf",
    name: "content",
    filename: pdf.filename
  });
  formData.append(
    "properties",
    JSON.stringify({
      documentType: "Generic Document",
      documentTitle: `Certificate of Insurance - ${coi.holder.name.trim()}`,
      issueDate: moment(coi.getFieldValue("/certificate/docdate")).format(
        "YYYY-MM-DD"
      ),
      customProperties
    })
  );

  info("Posting coi to IFT");
  let r = await fetch(`${IBM_FT_BASE_URL}/documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`
    },
    body: formData
  }).then(r => r.json());

  if (!r.id) {
    error("%O", r);
    throw "IFT post failed!";
  }

  return r.id;
}

(async () => {
  trace("Starting trellis IFT pusher");
  try {
    await service.start();
  } catch (e) {
    error("%O", e);
  }
})();
