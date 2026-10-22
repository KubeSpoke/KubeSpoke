using KubeSpoke.Contracts.Models;
using KubeSpoke.Server;
using KubeSpoke.Server.Hubs;
using KubeSpoke.Server.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using System;
using System.ComponentModel.DataAnnotations;
using System.Text;

namespace KubeSpoke.Server.Controllers
{
    [Authorize]
    public class AgentController : BaseController
    {
        IHubContext<ClusterAgentHub> hubContext;
        public AgentController(IHubContext<ClusterAgentHub> hubContext)
        {
            this.hubContext = hubContext;
        }

        [HttpGet]
        public IList<ClusterAgent> OnlineAgent()
        {
            return Global.OnlineUsers;
        }

        /// <summary>
        /// 生成集群 agent 的安装清单
        /// </summary>
        /// <param name="configuration"></param>
        /// <param name="uuid"></param>
        /// <param name="name">集群名</param>
        /// <param name="dealerId"></param>
        /// <param name="tag">agent 镜像 tag，不传则用 AgentImageTag 配置</param>
        /// <returns></returns>
        [HttpGet]
        public ContentResult Install(
            [FromServices] IConfiguration configuration,
            string? uuid, [Required] string name, string? dealerId, string? tag)
        {
            if (string.IsNullOrEmpty(uuid))
                uuid = Guid.NewGuid().ToString();

            var image = configuration["AgentImage"] ?? "crpi-gr7j2r1czfy1t1uu.cn-hangzhou.personal.cr.aliyuncs.com/springhgui/kubespoke-agent";
            var imageTag = string.IsNullOrEmpty(tag) ? (configuration["AgentImageTag"] ?? "latest") : tag;

            var host = $"{Request.Scheme}://{Request.Host}/cluster-agent?uuid={uuid}&name={name}";

            var yaml = Yaml.Replace("${HOST}", host)
                .Replace("${UUID}", uuid)
                .Replace("${IMAGE}", image)
                .Replace("${TAG}", imageTag)
                .Replace("${NAME}", name);

            return Content(yaml);
        }

        const string Yaml = """
            ---
            apiVersion: v1
            kind: Namespace
            metadata:
              name: kubespoke

            ---

            apiVersion: apps/v1
            kind: Deployment
            metadata:
              namespace: kubespoke
              creationTimestamp: null
              labels:
                app: kubespoke-agent
              name: kubespoke-agent
            spec:
              replicas: 1
              selector:
                matchLabels:
                  app: kubespoke-agent
              strategy: {}
              template:
                metadata:
                  creationTimestamp: null
                  labels:
                    app: kubespoke-agent
                spec:
                  containers:
                    - image: ${IMAGE}:${TAG}
                      name: kubespoke-agent-qhj6q
                      resources: {}
                      env:
                        - name: SERVER_ADDR
                          value: ${HOST}
                        - name: CLUSTER_UUID
                          value: ${UUID}
                        - name: CLUSTER_NAME
                          value: '${NAME}'
                        - name: CLUSTER_SECRET
                          value: CLUSTER_SECRET
                      volumeMounts:
                        - name: logs
                          mountPath: /app/Logs
                        - name: apps
                          mountPath: /apps
                  serviceAccountName: kubespoke-agent
                  volumes:
                    - name: logs
                      hostPath:
                        path: /apps/devops-agent/logs
                    - name: apps
                      hostPath:
                        path: /apps
            status: {}


            ---
            apiVersion: v1
            kind: ServiceAccount
            metadata:
              name: kubespoke-agent
              namespace: kubespoke

            ---
            apiVersion: rbac.authorization.k8s.io/v1
            kind: ClusterRole
            metadata:
              name: kubespoke-agent-admin
              labels:
                cattle.io/creator: "norman"
            rules:
              - apiGroups:
                  - "*"
                resources:
                  - "*"
                verbs:
                  - "*"
              - nonResourceURLs:
                  - "*"
                verbs:
                  - "*"

            ---
            apiVersion: rbac.authorization.k8s.io/v1
            kind: ClusterRoleBinding
            metadata:
              name: kubespoke-agent-admin-binding
              namespace: kubespoke
              labels:
                cattle.io/creator: "norman"
            subjects:
              - kind: ServiceAccount
                name: kubespoke-agent
                namespace: kubespoke
            roleRef:
              kind: ClusterRole
              name: kubespoke-agent-admin
              apiGroup: rbac.authorization.k8s.io
            
            """;
    }
}
