FROM node:13

COPY ./entrypoint.sh /entrypoint.sh
RUN chmod u+x /entrypoint.sh

WORKDIR /code/ift-pusher

CMD '/entrypoint.sh'

