(function (root) {
  "use strict";

  const examples = {
    "json": {
      category: "json",
      title: "API response",
      description: "Find added, removed, and changed fields in an API response while ignoring object key order.",
      formats: ["json","json"],
      sources: [
        `{
  "service": "catalog-api",
  "replicas": 2,
  "ports": [8080, 8443],
  "environment": {
    "LOG_LEVEL": "info",
    "LEGACY_MODE": true
  }
}`,
        `{
  "replicas": 3,
  "service": "catalog-api",
  "ports": [8080, 8443, 9090],
  "environment": {
    "LOG_LEVEL": "debug",
    "FEATURE_SEARCH": true
  }
}`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "position",
      },
    },
    "json-records": {
      category: "json",
      title: "Records matched by ID",
      description: "Match reordered records by id, then inspect a changed plan, a removed record, and a newly added record.",
      formats: ["json","json"],
      sources: [
        `{
  "users": [
    {
      "id": 101,
      "name": "Ada",
      "plan": "starter"
    },
    {
      "id": 102,
      "name": "Lin",
      "plan": "team"
    },
    {
      "id": 103,
      "name": "Sam",
      "plan": "starter"
    }
  ]
}`,
        `{
  "users": [
    {
      "id": 102,
      "name": "Lin",
      "plan": "team"
    },
    {
      "id": 101,
      "name": "Ada",
      "plan": "team"
    },
    {
      "id": 104,
      "name": "Jo",
      "plan": "starter"
    }
  ]
}`,
      ],
      options: {
        arrayMode: "keyed",
        arrayKey: "id",
        documents: "position",
      },
    },
    "json-unordered": {
      category: "json",
      title: "Unordered arrays",
      description: "Ignore reordered tags while still detecting an added tag and a removed duplicate.",
      formats: ["json","json"],
      sources: [
        `{
  "tags": [
    "api",
    "stable",
    "api",
    "public"
  ],
  "regions": [
    "eu-west-1",
    "us-east-1"
  ]
}`,
        `{
  "regions": [
    "us-east-1",
    "eu-west-1"
  ],
  "tags": [
    "public",
    "api",
    "stable",
    "v2"
  ]
}`,
      ],
      options: {
        arrayMode: "unordered",
        arrayKey: "name",
        documents: "position",
      },
    },
    "json-types": {
      category: "json",
      title: "Types and missing fields",
      description: "See why strings differ from numbers and booleans, and why null differs from a missing field.",
      formats: ["json","json"],
      sources: [
        `{
  "retries": "3",
  "enabled": "true",
  "timeout": null,
  "legacy": true
}`,
        `{
  "retries": 3,
  "enabled": true,
  "description": null
}`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "position",
      },
    },
    "json-cross-format": {
      category: "json",
      title: "JSON versus YAML",
      description: "Compare equivalent data across formats. Formatting and key order change, but the documents match.",
      formats: ["json","yaml"],
      sources: [
        `{
  "service": {
    "name": "catalog-api",
    "enabled": true,
    "ports": [
      8080,
      8443
    ],
    "owner": null
  }
}`,
        `service:
  owner: null
  ports: [8080, 8443]
  enabled: true
  name: catalog-api
`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "position",
      },
    },
    "yaml": {
      category: "yaml",
      title: "Service configuration",
      description: "Review a service image update, a replica change, a removed flag, and a newly added cache configuration.",
      formats: ["yaml","yaml"],
      sources: [
        `# Original service configuration
service:
  name: catalog-api
  replicas: 2
  image: catalog:1.0
  ports: [8080, 8443]
  debug: false
`,
        `# Updated service configuration
service:
  name: catalog-api
  replicas: 3
  image: catalog:1.1
  ports: [8080, 8443]
  cache:
    enabled: true
`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "position",
      },
    },
    "yaml-compose": {
      category: "yaml",
      title: "Docker Compose update",
      description: "Compare a Compose service image, port mapping, environment values, and a new restart policy.",
      formats: ["yaml","yaml"],
      sources: [
        `services:
  api:
    image: example/catalog:1.0
    ports: ["8080:8080"]
    environment:
      LOG_LEVEL: info
      LEGACY_MODE: "true"
`,
        `services:
  api:
    image: example/catalog:1.1
    ports: ["8081:8080"]
    restart: unless-stopped
    environment:
      LOG_LEVEL: debug
      CACHE_ENABLED: "true"
`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "position",
      },
    },
    "yaml-helm": {
      category: "yaml",
      title: "Helm values",
      description: "Compare chart values for replicas, CPU and memory requests, autoscaling, and a new ingress configuration.",
      formats: ["yaml","yaml"],
      sources: [
        `replicaCount: 2
image:
  repository: example/catalog
  tag: "1.0"
resources:
  requests:
    cpu: 100m
    memory: 128Mi
autoscaling:
  enabled: false
`,
        `image:
  repository: example/catalog
  tag: "1.1"
replicaCount: 3
resources:
  requests:
    cpu: 250m
    memory: 256Mi
autoscaling:
  enabled: true
ingress:
  enabled: true
  hostname: catalog.example.com
`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "position",
      },
    },
    "yaml-anchors": {
      category: "yaml",
      title: "Anchors and aliases",
      description: "Change an anchored timeout and see the inherited change highlighted at each alias reference.",
      formats: ["yaml","yaml"],
      sources: [
        `defaults: &defaults
  timeout: 30
  retries: 3
services:
  api: *defaults
  worker: *defaults
`,
        `defaults: &defaults
  timeout: 60
  retries: 3
services:
  api: *defaults
  worker: *defaults
`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "position",
      },
    },
    "yaml-equivalent": {
      category: "yaml",
      title: "Comments and key order",
      description: "See a zero-change comparison: comments, key order, quote style, and flow versus block arrays do not change values.",
      formats: ["yaml","yaml"],
      sources: [
        `# Original layout
service:
  name: "catalog-api"
  enabled: true
  ports:
    - 8080
    - 8443
`,
        `# A different layout, the same data
service:
  ports: [8080, 8443]
  enabled: true
  name: catalog-api
`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "position",
      },
    },
    "kubernetes": {
      category: "kubernetes",
      title: "Deployment and Service",
      description: "Match reordered Deployment and Service documents by resource identity, then review the replica and image updates.",
      formats: ["yaml","yaml"],
      sources: [
        `apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog-api
  namespace: production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: catalog
  template:
    metadata:
      labels:
        app: catalog
    spec:
      containers:
        - name: api
          image: catalog:1.0
---
apiVersion: v1
kind: Service
metadata:
  name: catalog-api
  namespace: production
spec:
  selector:
    app: catalog
  ports:
    - name: http
      port: 80
      targetPort: 8080
`,
        `apiVersion: v1
kind: Service
metadata:
  name: catalog-api
  namespace: production
spec:
  selector:
    app: catalog
  ports:
    - name: http
      port: 80
      targetPort: 8080
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog-api
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: catalog
  template:
    metadata:
      labels:
        app: catalog
    spec:
      containers:
        - name: api
          image: catalog:1.1
`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "kubernetes",
      },
    },
    "kubernetes-config": {
      category: "kubernetes",
      title: "ConfigMap and resource changes",
      description: "Inspect changed ConfigMap values, a removed Service, and a new configuration resource despite document reordering.",
      formats: ["yaml","yaml"],
      sources: [
        `apiVersion: v1
kind: ConfigMap
metadata:
  name: catalog-config
  namespace: production
data:
  LOG_LEVEL: info
  CACHE_TTL: "30"
---
apiVersion: v1
kind: Service
metadata:
  name: legacy-metrics
  namespace: production
spec:
  selector:
    app: catalog
  ports:
    - port: 9090
      targetPort: 9090
`,
        `apiVersion: v1
kind: ConfigMap
metadata:
  name: worker-config
  namespace: production
data:
  CONCURRENCY: "4"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: catalog-config
  namespace: production
data:
  LOG_LEVEL: debug
  CACHE_TTL: "60"
`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "kubernetes",
      },
    },
    "kubernetes-containers": {
      category: "kubernetes",
      title: "Containers and sidecars",
      description: "Match containers by name so a reordered sidecar stays unchanged while the API image and resource request update.",
      formats: ["yaml","yaml"],
      sources: [
        `apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog-api
  namespace: production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: catalog
  template:
    metadata:
      labels:
        app: catalog
    spec:
      containers:
        - name: api
          image: example/catalog:1.0
          resources:
            requests:
              cpu: 100m
        - name: log-agent
          image: example/log-agent:2.0
`,
        `apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog-api
  namespace: production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: catalog
  template:
    metadata:
      labels:
        app: catalog
    spec:
      containers:
        - name: log-agent
          image: example/log-agent:2.0
        - name: api
          image: example/catalog:1.1
          resources:
            requests:
              cpu: 250m
`,
      ],
      options: {
        arrayMode: "keyed",
        arrayKey: "name",
        documents: "kubernetes",
      },
    },
    "kubernetes-ingress": {
      category: "kubernetes",
      title: "Ingress routing",
      description: "Compare an ingress host and path, the destination Service, and a newly added TLS configuration.",
      formats: ["yaml","yaml"],
      sources: [
        `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: catalog
  namespace: production
spec:
  ingressClassName: nginx
  rules:
    - host: old.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: catalog-v1
                port:
                  number: 80
`,
        `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: catalog
  namespace: production
spec:
  ingressClassName: nginx
  rules:
    - host: catalog.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: catalog-v2
                port:
                  number: 80
  tls:
    - hosts: [catalog.example.com]
      secretName: catalog-tls
`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "kubernetes",
      },
    },
    "kubernetes-resources": {
      category: "kubernetes",
      title: "CPU and memory resources",
      description: "Review four resource quantity changes in the same container without changing its image or identity.",
      formats: ["yaml","yaml"],
      sources: [
        `apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog-api
  namespace: production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: catalog
  template:
    metadata:
      labels:
        app: catalog
    spec:
      containers:
        - name: api
          image: example/catalog:1.0
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
`,
        `apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalog-api
  namespace: production
spec:
  replicas: 2
  selector:
    matchLabels:
      app: catalog
  template:
    metadata:
      labels:
        app: catalog
    spec:
      containers:
        - name: api
          image: example/catalog:1.0
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: "1"
              memory: 512Mi
`,
      ],
      options: {
        arrayMode: "ordered",
        arrayKey: "name",
        documents: "kubernetes",
      },
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = examples;
  else root.NativeDiffExamples = examples;
})(typeof globalThis !== "undefined" ? globalThis : this);
