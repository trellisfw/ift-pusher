# ift-pusher

A microservice to enable Trellis integration with IBM Food Trust.

## Operation

Watches a job queue located in Trellis at `/bookmarks/servicers/ift-pusher`.

An example job that this service will run:

```JSON
{
  "service": "ift-pusher",
  "type": "sync",
  "config": {
    "resourceId": "resources/1cyKf2cX5ExCK8bG467gUvugEiS"
  },
  "status": "created",
  "updates": {
    "1fMaCFcJ7CEZtE1G8dXR2U3oSIn": {
      "status": "created",
      "time": "2020-07-29T13:44:45.182Z",
      "meta": "Job Created"
    }
  }
}
```
