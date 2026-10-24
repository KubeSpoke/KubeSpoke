#!/usr/bin/env bash
# 一行命令把 KubeSpoke Server 部署进当前 kubectl 上下文指向的集群：
#   bash <(curl -fsSL https://raw.githubusercontent.com/KubeSpoke/KubeSpoke/master/deploy-server.sh)
# 可用环境变量覆盖：NAMESPACE / IMAGE / SERVICE_TYPE / NODE_PORT / INGRESS_HOST / INGRESS_CLASS
#                      / INGRESS_TLS / INGRESS_TLS_SECRET / CERT_MANAGER_ISSUER / CERT_MANAGER_NS_ISSUER
#                      / HOST_PATH（控制台账号落在节点上的这个目录）
# 在终端里直接跑会先问用 NodePort 还是 nginx Ingress，选 Ingress 再问域名、是否启用 TLS、
# 证书是 cert-manager 自动签发还是已有 Secret；
# 用 curl | bash 管道跑不会弹问题，要走 Ingress 就自己带 INGRESS_HOST=xxx
#（要 https 再加 INGRESS_TLS=true，cert-manager 自动签发就再加 CERT_MANAGER_ISSUER=<ClusterIssuer 名>）。
set -euo pipefail

NAMESPACE="${NAMESPACE:-kubespoke}"
# 钉具体版本号，不用 :latest —— 打 tag 发版过去并不会刷新 :latest，钉住才不会装到旧版。
# 发新版本时这里要一并改（README 的 docker run 同理）。
IMAGE="${IMAGE:-crpi-gr7j2r1czfy1t1uu.cn-hangzhou.personal.cr.aliyuncs.com/springhgui/kubespoke-server:0.3.1}"
INGRESS_HOST="${INGRESS_HOST:-}"
INGRESS_CLASS="${INGRESS_CLASS:-nginx}"
# 控制台账号是 SQLite（/app/App_Data/kubespoke.db），不落卷就随 pod 重建消失。
# 用 hostPath 而不是 PVC：单副本场景不需要存储编排，代价是换节点即丢。
HOST_PATH="${HOST_PATH:-/data/kubespoke}"

# 有终端才交互式询问；curl | bash 这种管道执行 stdin 不是终端，只能靠环境变量传值
if [ -t 0 ] && [ -z "${INGRESS_HOST}" ]; then
  echo "Server 对外暴露方式："
  echo "  1) NodePort（默认，集群节点端口直接访问）"
  echo "  2) Ingress（当前支持 nginx-ingress，需要已解析到集群的域名）"
  read -r -p "选择 [1]: " choice
  if [ "${choice}" = "2" ]; then
    read -r -p "输入域名: " INGRESS_HOST
    while [ -z "${INGRESS_HOST}" ]; do
      echo "域名不能为空，否则 Ingress 规则无效。"
      read -r -p "输入域名: " INGRESS_HOST
    done
  fi
fi

# 给了 INGRESS_HOST 就默认走 ClusterIP + Ingress，否则默认 NodePort
SERVICE_TYPE="${SERVICE_TYPE:-$( [ -n "${INGRESS_HOST}" ] && echo ClusterIP || echo NodePort )}"
NODE_PORT="${NODE_PORT:-30080}"

# TLS 只对 Ingress 有意义；没从环境变量给值时，终端里问一句，管道执行一律不启用
ASKED_TLS=""
if [ -z "${INGRESS_TLS:-}" ] && [ -n "${INGRESS_HOST}" ] && [ -t 0 ]; then
  read -r -p "是否为 ${INGRESS_HOST} 启用 TLS（https）？[y/N]: " tls_answer
  INGRESS_TLS="$( case "${tls_answer}" in y|Y|yes|YES|true|1) echo true ;; *) echo false ;; esac )"
  ASKED_TLS=true
fi
case "$(printf '%s' "${INGRESS_TLS:-}" | tr '[:upper:]' '[:lower:]')" in
  y|yes|1|on|true) INGRESS_TLS=true ;;
  *) INGRESS_TLS=false ;;
esac
INGRESS_TLS_SECRET="${INGRESS_TLS_SECRET:-kubespoke-server-tls}"
if [ "${INGRESS_TLS}" = true ] && [ -n "${ASKED_TLS}" ]; then
  echo "证书来源："
  echo "  1) cert-manager 自动签发（集群里已装 cert-manager，Ingress 上会加 issuer 注解）"
  echo "  2) 已有 TLS Secret（自己 kubectl create secret tls 填进下面的名字）"
  read -r -p "选择 [2]: " tls_source
  if [ "${tls_source}" = "1" ]; then
    echo "  1) ClusterIssuer（集群级，最常见）"
    echo "  2) Issuer（仅当前命名空间）"
    read -r -p "Issuer 类型 [1]: " issuer_kind
    if [ "${issuer_kind}" = "2" ]; then
      read -r -p "Issuer 名称: " issuer_name
      CERT_MANAGER_NS_ISSUER="${issuer_name}"
    else
      read -r -p "ClusterIssuer 名称 [letsencrypt-prod]: " issuer_name
      CERT_MANAGER_ISSUER="${issuer_name:-letsencrypt-prod}"
    fi
  else
    read -r -p "TLS 证书 Secret 名称 [${INGRESS_TLS_SECRET}]: " tls_secret
    INGRESS_TLS_SECRET="${tls_secret:-${INGRESS_TLS_SECRET}}"
  fi
fi

# cert-manager 只认注解：没有它，spec.tls.secretName 指向的 Secret 永远不会被写入，
# nginx 会退回自签的 fake certificate，https 握手直接失败。
CM_ANNOTATION_KEY=""
if [ -n "${CERT_MANAGER_ISSUER:-}" ]; then
  CM_ANNOTATION_KEY="cert-manager.io/cluster-issuer"
elif [ -n "${CERT_MANAGER_NS_ISSUER:-}" ]; then
  CM_ANNOTATION_KEY="cert-manager.io/issuer"
fi
INGRESS_CM_ANNOTATION=""
if [ -n "${CM_ANNOTATION_KEY}" ]; then
  CM_ANNOTATION_VALUE="${CERT_MANAGER_ISSUER:-${CERT_MANAGER_NS_ISSUER}}"
  INGRESS_CM_ANNOTATION="
    ${CM_ANNOTATION_KEY}: ${CM_ANNOTATION_VALUE}"
fi

INGRESS_TLS_BLOCK=""
if [ "${INGRESS_TLS}" = true ]; then
  INGRESS_TLS_BLOCK="
  tls:
    - hosts:
        - ${INGRESS_HOST}
      secretName: ${INGRESS_TLS_SECRET}"
fi
SCHEME="$( [ "${INGRESS_TLS}" = true ] && echo https || echo http )"

NODE_PORT_LINE=""
if [ "${SERVICE_TYPE}" = "NodePort" ]; then
  NODE_PORT_LINE="nodePort: ${NODE_PORT}"
fi

kubectl apply -f - <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${NAMESPACE}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kubespoke-server
  namespace: ${NAMESPACE}
  labels:
    app: kubespoke-server
spec:
  replicas: 1
  # RollingUpdate 会先起新 pod，两个 pod 抢同一个 hostPath 目录写同一个库；
  # Recreate 先把旧 pod 停干净。
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: kubespoke-server
  template:
    metadata:
      labels:
        app: kubespoke-server
    spec:
      containers:
        - name: kubespoke-server
          image: ${IMAGE}
          ports:
            - containerPort: 80
          volumeMounts:
            - name: app-data
              mountPath: /app/App_Data
      volumes:
        - name: app-data
          hostPath:
            path: ${HOST_PATH}
            type: DirectoryOrCreate
---
apiVersion: v1
kind: Service
metadata:
  name: kubespoke-server
  namespace: ${NAMESPACE}
spec:
  type: ${SERVICE_TYPE}
  selector:
    app: kubespoke-server
  ports:
    - port: 80
      targetPort: 80
      ${NODE_PORT_LINE}
EOF

if [ -n "${INGRESS_HOST}" ]; then
  echo "创建 Ingress（ingressClassName: ${INGRESS_CLASS}${INGRESS_TLS_BLOCK:+, TLS Secret: ${INGRESS_TLS_SECRET}}${INGRESS_CM_ANNOTATION:+, ${CM_ANNOTATION_KEY}: ${CM_ANNOTATION_VALUE}}）: ${INGRESS_HOST} ..."
  kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kubespoke-server
  namespace: ${NAMESPACE}
  annotations:
    # Agent 的 Pod 日志走 WebSocket（/pod-log），nginx 需要透传 Upgrade 头
    nginx.ingress.kubernetes.io/proxy-http-version: "1.1"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"${INGRESS_CM_ANNOTATION}
spec:
  ingressClassName: ${INGRESS_CLASS}
${INGRESS_TLS_BLOCK}
  rules:
    - host: ${INGRESS_HOST}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: kubespoke-server
                port:
                  number: 80
EOF
fi

echo "等待 Server 就绪..."
kubectl -n "${NAMESPACE}" rollout status deployment/kubespoke-server --timeout=180s

NODE_IP=$(kubectl get nodes -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="ExternalIP")].address}{"\n"}{.status.addresses[?(@.type=="InternalIP")].address}{"\n"}{end}' | grep -v '^$' | head -1)
echo ""
echo "KubeSpoke Server 已部署。"
if [ -n "${INGRESS_HOST}" ]; then
  echo "控制台地址:  ${SCHEME}://${INGRESS_HOST}/"
  echo "接入集群:    curl \"${SCHEME}://${INGRESS_HOST}/api/Agent/Install?name=<集群名>\" | kubectl apply -f -"
  if [ "${INGRESS_TLS}" = true ]; then
    if [ -n "${CM_ANNOTATION_KEY}" ]; then
      echo "提示:        证书由 ${CM_ANNOTATION_KEY}=${CM_ANNOTATION_VALUE} 自动签发，写入 Secret ${NAMESPACE}/${INGRESS_TLS_SECRET}；"
      echo "             签发要等几十秒，没下来就查：kubectl -n ${NAMESPACE} describe certificate kubespoke-server"
    else
      echo "提示:        证书需先放进 Secret ${NAMESPACE}/${INGRESS_TLS_SECRET}："
      echo "             kubectl -n ${NAMESPACE} create secret tls ${INGRESS_TLS_SECRET} --cert=fullchain.pem --key=privkey.pem"
      echo "             证书没就绪前 https 会握手失败（nginx 会退回自签的 fake certificate）。"
    fi
    echo "             域名要解析到 ${INGRESS_CLASS} ingress 的入口地址。"
  else
    echo "提示:        域名需解析到 ${INGRESS_CLASS} ingress 的入口地址；要改 https 可带 INGRESS_TLS=true 重跑（Secret 名用 INGRESS_TLS_SECRET 指定）"
  fi
elif [ "${SERVICE_TYPE}" = "NodePort" ]; then
  echo "控制台地址:  http://${NODE_IP:-<节点IP>}:${NODE_PORT}/"
  echo "接入集群:    curl \"http://${NODE_IP:-<节点IP>}:${NODE_PORT}/api/Agent/Install?name=<集群名>\" | kubectl apply -f -"
else
  echo "通过 Service ${NAMESPACE}/kubespoke-server (type=${SERVICE_TYPE}) 访问。"
fi
