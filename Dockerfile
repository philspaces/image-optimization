# -- BUILD STAGE --------------------------------
FROM node:16.14.2-slim AS build
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
WORKDIR /src

COPY package.json ./
COPY package-lock.json ./
COPY .eslintrc.json ./

RUN npm ci

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

# -- RUNTIME STAGE --------------------------------
FROM node:16.14.2-slim
ENTRYPOINT [ "node" ]
WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install --no-install-recommends --no-install-suggests -y \
		git \
	\
	&& rm -rf /var/lib/apt/lists/*

# Install app dependencies
COPY package*.json ./

RUN npm ci --production

COPY --from=build /src/build/src /app

CMD [ "/app/index.js" ]
