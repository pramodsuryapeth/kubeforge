
"""
Local knowledge base of Kubernetes/Window node-readiness and execution
issues. Each entry: symptoms (keywords), root cause, a remediation plan
(each step optionally carrying a `rollback` command the backend uses for
Rollback), and a baseline risk level.

Add new entries here to extend what KubeForge AI can diagnose — nothing
else in the service needs to change.
"""


KNOWLEDGE_BASE = [
    {
        "id": "windows-kubelet-windows-service-flag",
        "title": "kubelet.exe is not running with the --windows-service flag",
        "keywords": ["kubelet --windows-service", "windows service kubelet", "kubelet.exe exit 1067", "service terminated unexpectedly"],
        "root_cause": "When kubelet.exe runs as a Windows service it must be started with --windows-service and a valid --log-file, otherwise Windows Service Manager terminates it with error 1067 or 1053 because kubelet does not communicate with the Service Control Manager correctly.",
        "remediation": [
            {
                "action": "check_kubelet_flags",
                "description": "Inspect the kubelet service binPath for --windows-service",
                "command": "sc.exe qc kubelet",
                "rollback": None
            },
            {
                "action": "add_windows_service_flag",
                "description": "Reconfigure the kubelet service to include --windows-service and --log-file",
                "command": "sc.exe config kubelet binPath= \"C:\\k\\kubelet.exe --windows-service --log-file=C:\\var\\log\\kubelet\\kubelet.log --config=C:\\var\\lib\\kubelet\\config.yaml\"",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-containerd-npipe-missing",
        "title": "containerd named pipe is missing on Windows",
        "keywords": ["npipe", "containerd-containerd", "\\\\.\\pipe\\containerd-containerd", "runtime endpoint windows", "named pipe missing"],
        "root_cause": "Windows containerd exposes a named pipe rather than a Unix socket. kubelet must be configured with npipe:////./pipe/containerd-containerd. A stale Linux-style socket path in the kubelet config makes sandbox creation fail.",
        "remediation": [
            {
                "action": "check_pipe",
                "description": "List named pipes visible on the node",
                "command": "powershell -Command \"[System.IO.Directory]::GetFiles('\\\\.\\pipe\\') | Where-Object { $_ -match 'containerd' }\"",
                "rollback": None
            },
            {
                "action": "fix_runtime_endpoint",
                "description": "Set kubelet's runtime endpoint to the containerd named pipe",
                "command": "powershell -Command \"(Get-Content C:\\var\\lib\\kubelet\\config.yaml) -replace 'containerRuntimeEndpoint:.*','containerRuntimeEndpoint: npipe:////./pipe/containerd-containerd' | Set-Content C:\\var\\lib\\kubelet\\config.yaml; Restart-Service kubelet\"",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-windows-service-manager-timeout",
        "title": "kubelet or containerd hits the Windows SCM startup timeout",
        "keywords": ["error 1053", "service did not respond", "SCM timeout", "windows service startup"],
        "root_cause": "Windows Service Control Manager waits a fixed time for a service to report SERVICE_RUNNING. A slow initialization (large image store, slow HNS) causes the SCM to declare the service failed even when it would have started.",
        "remediation": [
            {
                "action": "inspect_service_events",
                "description": "Read the SCM and service error events",
                "command": "powershell -Command \"Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Service Control Manager'} -MaxEvents 40 | Format-Table TimeCreated, Id, Message -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Investigate and fix the slow startup cause rather than extending the SCM timeout blindly",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-netsh-winsock-corruption",
        "title": "Windows Winsock or IP stack is corrupted",
        "keywords": ["winsock", "netsh winsock reset", "netsh int ip reset", "network stack corruption", "windows networking broken"],
        "root_cause": "Winsock catalog corruption or a bad TCP/IP stack state after cloning, driver updates, or antivirus installs produces intermittent pod and node connectivity problems that look like CNI issues.",
        "remediation": [
            {
                "action": "inspect_stack",
                "description": "Show IP configuration and check for obvious errors",
                "command": "powershell -Command \"ipconfig /all; Get-NetAdapter | Format-Table Name, Status, LinkSpeed -AutoSize\"",
                "rollback": None
            },
            {
                "action": "reset_winsock",
                "description": "Reset Winsock and TCP/IP stack during a maintenance window on a disposable node",
                "command": "powershell -Command \"netsh winsock reset; netsh int ip reset; Restart-Computer -Force\"",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-dns-client-cache-stale",
        "title": "Windows DNS client cache serves stale entries",
        "keywords": ["DNS client cache", "ipconfig /flushdns", "Clear-DnsClientCache", "stale DNS windows", "windows dns"],
        "root_cause": "The Windows DNS Client service caches resolutions. After control-plane changes or Service DNS updates, stale cache entries produce intermittent DNS failures on the node.",
        "remediation": [
            {
                "action": "flush_dns",
                "description": "Flush the Windows DNS client cache",
                "command": "powershell -Command \"Clear-DnsClientCache; ipconfig /flushdns\"",
                "rollback": None
            },
            {
                "action": "check_dns_config",
                "description": "Verify DNS servers and resolution order",
                "command": "powershell -Command \"Get-DnsClientServerAddress; Resolve-DnsName kubernetes.default.svc.cluster.local -ErrorAction SilentlyContinue\"",
                "rollback": None
            }
        ],
        "risk_level": "low"
    },
    {
        "id": "windows-dns-suffix-mismatch",
        "title": "Windows DNS suffix is wrong and breaks node name resolution",
        "keywords": ["DNS suffix", "ConnectionSpecificSuffix", "primary dns suffix", "windows hostname resolution", "getent equivalent windows"],
        "root_cause": "Windows appends a DNS suffix to short names. If the suffix does not match the environment, `ping <nodename>` and API server name resolution behave inconsistently.",
        "remediation": [
            {
                "action": "inspect_suffix",
                "description": "Show the configured DNS suffix search list",
                "command": "powershell -Command \"Get-DnsClientGlobalSetting; Get-DnsClient | Select-Object InterfaceAlias, ConnectionSpecificSuffix\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Align the primary DNS suffix with the environment or use FQDNs in cluster configuration",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-hosts-file-entry",
        "title": "Windows hosts file has stale or wrong Kubernetes entries",
        "keywords": ["C:\\Windows\\System32\\drivers\\etc\\hosts", "windows hosts file", "stale api server", "hosts entry"],
        "root_cause": "Leftover entries in the Windows hosts file (from a previous control plane or cluster) can shadow DNS and cause kubelet to reach the wrong API server.",
        "remediation": [
            {
                "action": "inspect_hosts",
                "description": "Show the Windows hosts file",
                "command": "powershell -Command \"Get-Content C:\\Windows\\System32\\drivers\\etc\\hosts\"",
                "rollback": None
            },
            {
                "action": "fix_hosts",
                "description": "Remove or correct stale entries",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-ipconfig-static-dhcp-conflict",
        "title": "Windows node has a static IP that conflicts with DHCP",
        "keywords": ["static IP windows", "duplicate IP windows", "ipconfig", "New-NetIPAddress", "DHCP conflict windows"],
        "root_cause": "Windows nodes configured with a static IP inside a DHCP range can receive the same address as another host, producing duplicate-IP symptoms on the pod and node networks.",
        "remediation": [
            {
                "action": "inspect_ip",
                "description": "Check IP configuration and duplicate-address events",
                "command": "powershell -Command \"Get-NetIPAddress -AddressFamily IPv4 | Format-Table InterfaceAlias, IPAddress, PrefixLength -AutoSize; Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-TCPIP'} -MaxEvents 30 | Format-Table TimeCreated, Id, Message -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Move the static IP outside the DHCP pool or reserve it on the DHCP server",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-multiple-default-gateways",
        "title": "Windows node has multiple default gateways",
        "keywords": ["multiple default gateway", "DefaultIPGateway", "route print", "ambiguous routing windows"],
        "root_cause": "Multiple NICs with separate default gateways create ambiguous routing. Pod traffic may leave through the wrong interface and fail TLS or DNS.",
        "remediation": [
            {
                "action": "inspect_routes",
                "description": "Show interfaces, IP configuration, and routes",
                "command": "powershell -Command \"Get-NetIPConfiguration; route print -4\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Keep a single default gateway and use metrics or policy routing for the others",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-nic-teaming-cni-conflict",
        "title": "NIC teaming on Windows conflicts with HNS overlay networking",
        "keywords": ["NIC teaming", "LBFO", "SET", "windows teaming", "HNS overlay windows"],
        "root_cause": "Some NIC teaming modes interact badly with HNS overlay networking and VFP, causing intermittent packet loss or pod network failures.",
        "remediation": [
            {
                "action": "inspect_team",
                "description": "Check NIC teaming configuration",
                "command": "powershell -Command \"Get-NetLbfoTeam -ErrorAction SilentlyContinue; Get-NetSwitchTeam -ErrorAction SilentlyContinue; Get-NetAdapter | Format-Table Name, Status, LinkSpeed -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Follow the CNI vendor's supported NIC teaming guidance for Windows nodes",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-vlan-tagging-mismatch",
        "title": "Windows node VLAN tagging is wrong",
        "keywords": ["VLAN", "Set-NetAdapterAdvancedProperty", "VlanID", "trunk", "windows NIC VLAN"],
        "root_cause": "Windows NIC VLAN tagging must match the physical switch configuration. A mismatch silently blocks overlay and API-server traffic.",
        "remediation": [
            {
                "action": "inspect_vlan",
                "description": "Check adapter advanced properties for VLAN settings",
                "command": "powershell -Command \"Get-NetAdapterAdvancedProperty | Where-Object DisplayName -match 'VLAN' | Format-Table Name, DisplayName, DisplayValue -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Reconcile VLAN tags with the switch configuration",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-cert-store-ca-missing",
        "title": "Private registry CA is not in the Windows certificate store",
        "keywords": ["certutil", "Import-Certificate", "Root store windows", "private registry CA", "x509 windows"],
        "root_cause": "containerd on Windows validates registry TLS using the Windows certificate store. A missing CA produces x509 errors even though the CA is present on Linux control-plane nodes.",
        "remediation": [
            {
                "action": "import_ca",
                "description": "Import the private registry CA into the LocalMachine Root store",
                "command": "powershell -Command \"Import-Certificate -FilePath C:\\temp\\registry-ca.crt -CertStoreLocation Cert:\\LocalMachine\\Root\"",
                "rollback": "powershell -Command \"Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object Subject -match '<CA Common Name>' | Remove-Item\""
            },
            {
                "action": "restart_containerd",
                "description": "Restart containerd so it picks up the trust store",
                "command": "powershell -Command \"Restart-Service containerd; Get-Service containerd\"",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-registry-auth-config-missing",
        "title": "containerd on Windows has no registry authentication configured",
        "keywords": ["registry auth windows", "containerd registry config", "C:\\ProgramData\\containerd\\certs.d", "windows registry auth"],
        "root_cause": "Windows containerd expects registry configuration under C:\\ProgramData\\containerd\\certs.d\\<host>\\hosts.toml. Missing files cause anonymous pulls that fail against private registries.",
        "remediation": [
            {
                "action": "inspect_registry_config",
                "description": "List Windows containerd registry configuration",
                "command": "powershell -Command \"Get-ChildItem C:\\ProgramData\\containerd\\certs.d -Recurse -ErrorAction SilentlyContinue\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Add hosts.toml for each private registry per the containerd documentation",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-containerd-log-file-missing",
        "title": "Windows containerd produces no log file",
        "keywords": ["containerd log windows", "containerd.log", "--log-file", "windows containerd debug"],
        "root_cause": "On Windows, containerd writes logs to a file specified at startup. Without --log-file, containerd logs are lost and troubleshooting becomes much harder.",
        "remediation": [
            {
                "action": "check_service_log",
                "description": "Inspect the containerd service binPath for --log-file",
                "command": "sc.exe qc containerd",
                "rollback": None
            },
            {
                "action": "enable_logging",
                "description": "Configure a log file and restart containerd",
                "command": "sc.exe config containerd binPath= \"C:\\Program Files\\containerd\\containerd.exe --log-file C:\\ProgramData\\containerd\\containerd.log --log-level info\"",
                "rollback": None
            }
        ],
        "risk_level": "low"
    },
    {
        "id": "windows-containerd-debug-disabled",
        "title": "containerd debug logging is off and hides the failure",
        "keywords": ["containerd debug", "log-level", "windows containerd debug", "containerd troubleshooting windows"],
        "root_cause": "containerd at info level omits the detailed gRPC and HNS errors needed to diagnose sandbox failures on Windows.",
        "remediation": [
            {
                "action": "enable_debug",
                "description": "Set containerd log-level to debug temporarily",
                "command": "powershell -Command \"(Get-Content 'C:\\Program Files\\containerd\\config.toml') -replace 'level = \\\"info\\\"','level = \\\"debug\\\"' | Set-Content 'C:\\Program Files\\containerd\\config.toml'; Restart-Service containerd\"",
                "rollback": "powershell -Command \"(Get-Content 'C:\\Program Files\\containerd\\config.toml') -replace 'level = \\\"debug\\\"','level = \\\"info\\\"' | Set-Content 'C:\\Program Files\\containerd\\config.toml'; Restart-Service containerd\""
            }
        ],
        "risk_level": "low"
    },
    {
        "id": "windows-kubelet-log-file-missing",
        "title": "Windows kubelet has no log file configured",
        "keywords": ["kubelet log windows", "kubelet.log", "C:\\var\\log\\kubelet", "--log-file", "windows kubelet debug"],
        "root_cause": "As a Windows service, kubelet writes to a --log-file. If it is not set, its output goes nowhere and diagnosis is nearly impossible.",
        "remediation": [
            {
                "action": "check_kubelet_log",
                "description": "Check the kubelet service binPath for --log-file",
                "command": "sc.exe qc kubelet; powershell -Command \"Test-Path C:\\var\\log\\kubelet\\kubelet.log\"",
                "rollback": None
            },
            {
                "action": "configure_log",
                "description": "Reconfigure kubelet with a log file and restart",
                "command": "sc.exe config kubelet binPath= \"C:\\k\\kubelet.exe --windows-service --log-file=C:\\var\\log\\kubelet\\kubelet.log --config=C:\\var\\lib\\kubelet\\config.yaml\"; sc.exe stop kubelet; sc.exe start kubelet",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-healthz-port-conflict",
        "title": "kubelet healthz port is already in use on Windows",
        "keywords": ["healthz port", "10248", "port conflict kubelet", "windows port in use", "netsh http"],
        "root_cause": "Another Windows service or an HTTP.SYS reservation can occupy the kubelet healthz port. kubelet then fails to start with 'address already in use'.",
        "remediation": [
            {
                "action": "find_port_owner",
                "description": "Identify the process listening on the healthz port",
                "command": "powershell -Command \"Get-NetTCPConnection -LocalPort 10248 -ErrorAction SilentlyContinue | Format-Table LocalAddress, LocalPort, OwningProcess -AutoSize; netsh http show urlacl\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Free the port by stopping the offending service or changing kubelet's healthz port",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-hostprocess-container-support",
        "title": "HostProcess containers are not supported on this Windows node",
        "keywords": ["HostProcess", "windows hostprocess", "windowsOptions hostProcess", "privileged windows"],
        "root_cause": "HostProcess containers require a specific Windows feature set and a compatible container runtime handler. Enabling them without matching runtime support causes pods to fail at sandbox creation.",
        "remediation": [
            {
                "action": "check_capability",
                "description": "Confirm the runtime and OS support HostProcess containers",
                "command": "powershell -Command \"(Get-CimInstance Win32_OperatingSystem).Version; crictl info 2>$null\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Enable or install the required Windows container features/handlers per the Kubernetes Windows documentation",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-csi-proxy-missing",
        "title": "CSI Proxy is not running on the Windows node",
        "keywords": ["csi-proxy", "csi-proxy.exe", "CSI plugin windows", "windows csi", "csi-proxy pipe"],
        "root_cause": "CSI drivers on Windows communicate with the host through CSI Proxy over a named pipe. Without csi-proxy.exe, volume operations for CSI drivers fail and pods using them stay Pending.",
        "remediation": [
            {
                "action": "check_csi_proxy",
                "description": "Check the CSI Proxy service and named pipe",
                "command": "powershell -Command \"Get-Service csi-proxy -ErrorAction SilentlyContinue; [System.IO.Directory]::GetFiles('\\\\.\\pipe\\') | Where-Object { $_ -match 'csi' }\"",
                "rollback": None
            },
            {
                "action": "install_csi_proxy",
                "description": "Install and start CSI Proxy from its upstream release",
                "command": "powershell -Command \"Invoke-WebRequest -Uri https://github.com/kubernetes-csi/csi-proxy/releases/latest/download/csi-proxy.exe -OutFile C:\\k\\csi-proxy.exe; New-Service -Name csi-proxy -BinaryPathName C:\\k\\csi-proxy.exe -StartupType Automatic; Start-Service csi-proxy\"",
                "rollback": "powershell -Command \"Stop-Service csi-proxy; Remove-Service csi-proxy; Remove-Item C:\\k\\csi-proxy.exe\""
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-smb-mount-failure",
        "title": "SMB volume mount fails on a Windows pod",
        "keywords": ["SMB", "CIFS windows", "New-SmbMapping", "windows volume", "smb csi windows"],
        "root_cause": "SMB mounts on Windows require the SMB client, firewall access to port 445, and valid credentials. Missing components or blocked egress cause pod startup failures.",
        "remediation": [
            {
                "action": "test_smb",
                "description": "Test SMB reachability and authentication from the node",
                "command": "powershell -Command \"Test-NetConnection <smb-host> -Port 445; net use \\\\<smb-host>\\<share> /user:<user> <password>\"",
                "rollback": "powershell -Command \"net use \\\\<smb-host>\\<share> /delete\""
            },
            {
                "action": "manual_review",
                "description": "Fix SMB server reachability, credentials, or the driver configuration",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-iscsi-volume-missing",
        "title": "iSCSI volume is not attached on the Windows node",
        "keywords": ["iSCSI", "iscsicpl", "Get-IscsiSession", "windows iscsi", "disk offline"],
        "root_cause": "CSI drivers that use iSCSI require the Microsoft iSCSI Initiator, a discoverable target, and the multipath service. Without these, the disk never appears and pods cannot start.",
        "remediation": [
            {
                "action": "check_iscsi",
                "description": "Check iSCSI sessions and the initiator service",
                "command": "powershell -Command \"Get-Service msiscsi; Get-IscsiSession -ErrorAction SilentlyContinue | Format-Table TargetNodeAddress, IsConnected -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Install/enable the iSCSI initiator and MPIO, then reconnect the target",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-azure-disk-csi-windows",
        "title": "Azure Disk CSI driver does not attach on Windows",
        "keywords": ["azuredisk-csi", "azure disk windows", "csi-proxy", "windows azure disk", "disk attach failed"],
        "root_cause": "Azure Disk CSI on Windows relies on CSI Proxy and a correctly configured node identity. Missing CSI Proxy, wrong node resource group, or blocked IMDS causes attach failures.",
        "remediation": [
            {
                "action": "check_csi_proxy_and_imds",
                "description": "Verify CSI Proxy is up and the node can reach IMDS",
                "command": "powershell -Command \"Get-Service csi-proxy -ErrorAction SilentlyContinue; Invoke-RestMethod -Uri 'http://169.254.169.254/metadata/instance?api-version=2021-02-01' -Headers @{Metadata='true'} -TimeoutSec 3\"",
                "rollback": None
            },
            {
                "action": "inspect_csi_pods",
                "description": "Inspect Azure Disk CSI pods and node logs",
                "command": "kubectl -n kube-system get pods -o wide | grep -i azuredisk; kubectl -n kube-system logs -l app=csi-azuredisk-node-windows --tail=120",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-containerd-windows-snapshotter",
        "title": "containerd snapshotter is not the Windows snapshotter",
        "keywords": ["windows snapshotter", "--snapshotter=windows", "windows-lcow", "containerd snapshotter windows"],
        "root_cause": "containerd on Windows must use the Windows snapshotter (or windows-lcow for LCOW). Using an overlayfs-style snapshotter fails because the filesystem semantics differ.",
        "remediation": [
            {
                "action": "check_snapshotter",
                "description": "Show the configured snapshotter in the service binPath",
                "command": "sc.exe qc containerd",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Ensure the containerd service uses --snapshotter=windows (or the documented value for the runtime version)",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-lcow-not-supported",
        "title": "Linux containers on Windows are no longer supported",
        "keywords": ["LCOW", "Linux Containers on Windows", "lcow deprecated", "windows linux container"],
        "root_cause": "LCOW was deprecated and removed. Attempts to run Linux containers via LCOW on modern Windows nodes will fail; Linux workloads must run on Linux nodes.",
        "remediation": [
            {
                "action": "verify_os_label",
                "description": "Confirm the workload is scheduled to the correct OS",
                "command": "kubectl get pod <pod> -n <ns> -o jsonpath='{.spec.nodeSelector}{\"\\n\"}'; kubectl get nodes -L kubernetes.io/os",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Schedule Linux workloads to Linux nodes and Windows workloads to Windows nodes",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-networking-runtime-mode",
        "title": "kubelet networking mode does not match the CNI on Windows",
        "keywords": ["network-plugin", "cni", "windows networking mode", "hns mode", "kubelet network"],
        "root_cause": "Windows kubelet must be configured for CNI networking and the associated HNS mode. A mismatch leaves the runtime expecting networking that the CNI will never provide.",
        "remediation": [
            {
                "action": "inspect_kubelet_config",
                "description": "Inspect kubelet config for network plugin settings",
                "command": "powershell -Command \"Get-Content C:\\var\\lib\\kubelet\\config.yaml -ErrorAction SilentlyContinue\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Match kubelet networking settings with the CNI plugin's Windows setup guide",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-hns-network-mode-l2bridge",
        "title": "HNS network mode does not match the CNI's expected mode",
        "keywords": ["L2Bridge", "L2Tunnel", "Overlay", "Get-HnsNetwork Type", "hns mode windows"],
        "root_cause": "Windows CNIs expect a specific HNS network type (L2Bridge, L2Tunnel, or Overlay). Choosing the wrong mode produces pod networking that appears up but cannot reach the destination.",
        "remediation": [
            {
                "action": "inspect_hns_mode",
                "description": "Show the HNS network type for the CNI-managed network",
                "command": "powershell -Command \"Get-HnsNetwork | Format-Table Name, Type, AddressPrefix -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Reconfigure the CNI/HNS to the mode documented for the CNI plugin",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-cni-overlay-vs-l2bridge",
        "title": "Windows CNI is configured for the wrong dataplane",
        "keywords": ["win-overlay", "win-bridge", "windows cni plugin", "cni windows dataplane"],
        "root_cause": "win-bridge and win-overlay implement different dataplanes. Using the wrong one produces pod connectivity that appears nominally functional but fails to route across nodes.",
        "remediation": [
            {
                "action": "inspect_cni_config",
                "description": "Read the Windows CNI configuration files",
                "command": "powershell -Command \"Get-ChildItem C:\\opt\\cni\\config -ErrorAction SilentlyContinue; Get-Content C:\\opt\\cni\\config\\*.conf -ErrorAction SilentlyContinue\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Select the CNI dataplane matching the cluster network design and reinstall the CNI on Windows accordingly",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-hnsnetwork-not-listed",
        "title": "Expected HNS network is not created",
        "keywords": ["hns network missing", "Get-HnsNetwork", "cni network not found", "windows pod network"],
        "root_cause": "The CNI plugin creates an HNS network at install time. If the plugin pod is unhealthy on the node or its RBAC is wrong, that network never appears and pods cannot start.",
        "remediation": [
            {
                "action": "inspect_hns_networks",
                "description": "List HNS networks and inspect CNI pod health",
                "command": "powershell -Command \"Get-HnsNetwork | Format-Table Name, Id, Type -AutoSize\"; kubectl -n kube-system get pods -o wide | grep -i win",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Repair the CNI pod so it can create the network, then restart it",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-hnsnetwork-duplicate",
        "title": "Duplicate HNS networks with conflicting subnets exist",
        "keywords": ["duplicate hns network", "overlapping hns", "windows subnet conflict", "Get-HnsNetwork duplicate"],
        "root_cause": "Leftover HNS networks from previous CNI installs can overlap with the current network's subnet, causing ambiguous routing for pods.",
        "remediation": [
            {
                "action": "list_networks",
                "description": "List HNS networks and their address prefixes",
                "command": "powershell -Command \"Get-HnsNetwork | Format-Table Name, Type, AddressPrefix -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Remove stale networks using the CNI plugin's documented procedure before recreating",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-hnspolicy-stale",
        "title": "Stale HNS policies block new pod creation",
        "keywords": ["hns policy stale", "Get-HnsPolicyList", "windows cni cleanup", "windows pod stuck"],
        "root_cause": "If a pod was removed without CNI cleanup, its HNS policies remain and can conflict with new pods assigned the same endpoint identifiers.",
        "remediation": [
            {
                "action": "list_policies",
                "description": "List HNS policies and correlate with pods",
                "command": "powershell -Command \"Get-HnsPolicyList | Format-Table Id, Type, Name -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Use the CNI plugin's cleanup procedure; do not delete HNS policies blindly",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-hnsls-connection-failure",
        "title": "HNS LS (Layered Service) is not responding",
        "keywords": ["HNS LS", "hns-ls", "Get-Service hns", "windows overlay service", "hns not responding"],
        "root_cause": "HNS relies on the Host Network Service and its layered services. If the service fails to initialize after a Windows update or driver change, overlay networking stops working.",
        "remediation": [
            {
                "action": "check_hns_state",
                "description": "Check HNS service state and related events",
                "command": "powershell -Command \"Get-Service hns; Get-WinEvent -LogName System -MaxEvents 60 | Where-Object { $_.ProviderName -match 'Host-Network' } | Format-Table TimeCreated, Id, Message -AutoSize\"",
                "rollback": None
            },
            {
                "action": "restart_hns",
                "description": "Restart HNS and confirm the service recovers",
                "command": "powershell -Command \"Restart-Service hns; Start-Sleep 3; Get-Service hns\"",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-ip-helper-service-missing",
        "title": "IP Helper service is stopped on the Windows node",
        "keywords": ["iphlpsvc", "IP Helper", "windows ip helper", "hns dependency"],
        "root_cause": "HNS depends on the IP Helper service (iphlpsvc) for tunnel and NAT functionality. If it is stopped or disabled, overlay networking fails.",
        "remediation": [
            {
                "action": "check_iphlpsvc",
                "description": "Check the IP Helper service state",
                "command": "powershell -Command \"Get-Service iphlpsvc; Get-Service iphlpsvc | Select-Object StartType\"",
                "rollback": None
            },
            {
                "action": "start_iphlpsvc",
                "description": "Enable and start IP Helper",
                "command": "powershell -Command \"Set-Service iphlpsvc -StartupType Automatic; Start-Service iphlpsvc\"",
                "rollback": "powershell -Command \"Stop-Service iphlpsvc\""
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-kube-proxy-hns-policy-sync-fail",
        "title": "kube-proxy cannot push HNS policies",
        "keywords": ["kube-proxy hns", "hns policy push failed", "kube-proxy windows error", "windows kube-proxy"],
        "root_cause": "kube-proxy on Windows needs the correct privileges and a healthy HNS to write policies. RBAC or HNS problems block the sync, leaving Services unreachable.",
        "remediation": [
            {
                "action": "check_kube_proxy_logs",
                "description": "Read kube-proxy logs for HNS errors",
                "command": "powershell -Command \"Get-EventLog -LogName Application -Source kube-proxy -Newest 40 -ErrorAction SilentlyContinue | Format-Table TimeGenerated, EntryType, Message -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Fix HNS or kube-proxy RBAC and restart kube-proxy",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-container-registry-mirror",
        "title": "Windows containerd registry mirror is misconfigured",
        "keywords": ["windows registry mirror", "certs.d windows", "hosts.toml windows", "containerd mirror windows"],
        "root_cause": "Windows containerd expects registry mirror configuration under C:\\ProgramData\\containerd\\certs.d. Wrong hostnames or missing TLS trust cause pulls to fail silently.",
        "remediation": [
            {
                "action": "inspect_mirror",
                "description": "List registry mirror configuration files",
                "command": "powershell -Command \"Get-ChildItem C:\\ProgramData\\containerd\\certs.d -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_.FullName; Get-Content $_.FullName }\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Correct the mirror host and TLS settings per the containerd documentation",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-containerd-mirror-no-fallback",
        "title": "Windows containerd has no fallback when the mirror fails",
        "keywords": ["fallback", "containerd mirror fallback", "windows registry down", "image pull windows failed"],
        "root_cause": "hosts.toml must specify fallback behavior. Without it, a mirror outage blocks all image pulls from the node.",
        "remediation": [
            {
                "action": "inspect_fallback",
                "description": "Check the mirror configuration for fallback settings",
                "command": "powershell -Command \"Get-Content C:\\ProgramData\\containerd\\certs.d\\*\\hosts.toml -ErrorAction SilentlyContinue\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Configure documented fallback behavior in hosts.toml",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-rotate-certs-windows",
        "title": "Windows kubelet certificate rotation is failing",
        "keywords": ["windows kubelet rotate certs", "csr windows", "certificate rotation windows", "kubelet.pem"],
        "root_cause": "Windows kubelet uses C:\\var\\lib\\kubelet\\pki. If the CA changed or the CSR approver is unhealthy, the Windows kubelet cannot renew its client certificate and eventually loses API access.",
        "remediation": [
            {
                "action": "inspect_certs",
                "description": "Inspect the kubelet certificate dates and CSR status",
                "command": "powershell -Command \"Get-ChildItem C:\\var\\lib\\kubelet\\pki -ErrorAction SilentlyContinue | Format-Table Name, LastWriteTime\"",
                "rollback": None
            },
            {
                "action": "approve_csrs",
                "description": "Approve any pending kubelet CSRs on the control plane",
                "command": "kubectl get csr | grep -i pending",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-kubelet-kubeconfig-not-loaded",
        "title": "Windows kubelet cannot load its kubeconfig",
        "keywords": ["kubeconfig windows", "C:\\etc\\kubernetes\\kubelet.conf", "kubelet load kubeconfig", "windows kubelet config"],
        "root_cause": "Windows kubelet expects kubelet.conf at C:\\etc\\kubernetes\\kubelet.conf. A file in the wrong encoding, path, or with wrong ACLs prevents startup.",
        "remediation": [
            {
                "action": "inspect_kubeconfig",
                "description": "Check the kubeconfig path and ACLs",
                "command": "powershell -Command \"Test-Path C:\\etc\\kubernetes\\kubelet.conf; Get-Acl C:\\etc\\kubernetes\\kubelet.conf -ErrorAction SilentlyContinue | Format-List\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Restore the installer-provided kubeconfig and correct ACLs to grant the kubelet service account read access",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-multiple-container-runtimes",
        "title": "Multiple container runtimes are installed on the Windows node",
        "keywords": ["docker and containerd", "multiple runtimes windows", "dockershim windows", "runtime conflict windows"],
        "root_cause": "Windows nodes may have both Docker and containerd installed. Competing services can occupy HNS, fight for named pipes, or leave conflicting state, breaking Kubernetes networking.",
        "remediation": [
            {
                "action": "list_runtimes",
                "description": "List installed container runtimes and services",
                "command": "powershell -Command \"Get-Service docker, containerd, cri-dockerd -ErrorAction SilentlyContinue\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Keep exactly one runtime active on the node unless the platform explicitly requires otherwise",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-docker-desktop-conflict",
        "title": "Docker Desktop on the Windows node conflicts with containerd",
        "keywords": ["Docker Desktop", "wsl2 backend", "windows node conflict", "developer desktop"],
        "root_cause": "Docker Desktop installs its own runtime, HNS networks, and WSL integrations, all of which conflict with containerd and Kubernetes on the same host.",
        "remediation": [
            {
                "action": "check_docker_desktop",
                "description": "Check for Docker Desktop installation",
                "command": "powershell -Command \"Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -match 'Docker Desktop' | Select-Object DisplayName, DisplayVersion\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Remove Docker Desktop from Kubernetes worker nodes; do not run developer tooling on cluster nodes",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-wsl2-conflict",
        "title": "WSL2 on the Windows node conflicts with HNS and VFP",
        "keywords": ["WSL2", "wsl", "hns conflict", "windows WSL kubernetes"],
        "root_cause": "WSL2 installs HNS networks and virtual switches that can interfere with the HNS state Kubernetes relies on, especially after WSL updates.",
        "remediation": [
            {
                "action": "check_wsl",
                "description": "List WSL distributions and state",
                "command": "powershell -Command \"wsl --list --verbose 2>$null\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Do not install WSL on Kubernetes worker nodes",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-user-rights-assignprimarytoken",
        "title": "kubelet service account is missing SeAssignPrimaryTokenPrivilege",
        "keywords": ["SeAssignPrimaryTokenPrivilege", "user rights", "kubelet privilege", "windows kubelet rights"],
        "root_cause": "Windows container creation requires SeAssignPrimaryTokenPrivilege and SeImpersonatePrivilege. Without them the runtime cannot create the container token and sandboxes fail.",
        "remediation": [
            {
                "action": "check_rights",
                "description": "Show who currently holds the required privileges",
                "command": "powershell -Command \"secedit /export /cfg $env:TEMP\\secpol.cfg; Select-String -Path $env:TEMP\\secpol.cfg -Pattern 'SeAssignPrimaryTokenPrivilege|SeImpersonatePrivilege'\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Grant the rights to the kubelet service account via secpol.msc or the installer script",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-kubelet-account-not-virtual",
        "title": "kubelet runs under the wrong Windows account",
        "keywords": ["NT AUTHORITY\\SYSTEM", "LocalSystem", "kubelet account", "windows service account kubelet"],
        "root_cause": "kubelet should run as LocalSystem or a dedicated account with the correct privileges. Running it as a plain user account causes failures in HNS, VFP, and container creation.",
        "remediation": [
            {
                "action": "inspect_account",
                "description": "Check the account the kubelet service runs under",
                "command": "powershell -Command \"Get-CimInstance Win32_Service -Filter \\\"Name='kubelet'\\\" | Select-Object Name, StartName, State\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Reconfigure the service account to LocalSystem (or the documented account) and restart kubelet",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-uac-blocking-scripts",
        "title": "UAC blocks provisioning scripts on the Windows node",
        "keywords": ["UAC", "User Account Control", "Run as administrator", "provisioning windows"],
        "root_cause": "Provisioning scripts and kubelet setup require elevation. UAC prompts or a non-elevated shell cause commands to silently fail or partially apply.",
        "remediation": [
            {
                "action": "check_elevation",
                "description": "Confirm whether the current shell is elevated",
                "command": "powershell -Command \"([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Run provisioning in an elevated PowerShell or via a service/agent that runs elevated",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-powershell-execution-policy",
        "title": "PowerShell execution policy blocks provisioning scripts",
        "keywords": ["ExecutionPolicy", "Restricted", "AllSigned", "powershell script blocked"],
        "root_cause": "Default execution policies (Restricted or AllSigned) prevent provisioning scripts from running, causing partial installs that look like network or config failures.",
        "remediation": [
            {
                "action": "check_policy",
                "description": "Check the effective PowerShell execution policy",
                "command": "powershell -Command \"Get-ExecutionPolicy -List\"",
                "rollback": None
            },
            {
                "action": "set_policy",
                "description": "Set the machine-level policy to RemoteSigned for provisioning",
                "command": "powershell -Command \"Set-ExecutionPolicy -Scope LocalMachine RemoteSigned -Force\"",
                "rollback": "powershell -Command \"Set-ExecutionPolicy -Scope LocalMachine Restricted -Force\""
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-winrm-disabled",
        "title": "WinRM is disabled on the Windows node and blocks remote provisioning",
        "keywords": ["WinRM", "5985", "5986", "Enable-PSRemoting", "remote provisioning windows"],
        "root_cause": "Automation tools (Ansible, custom scripts, provisioning agents) often use WinRM to manage Windows nodes. If WinRM is disabled or blocked, provisioning fails silently.",
        "remediation": [
            {
                "action": "check_winrm",
                "description": "Check WinRM service and listener state",
                "command": "powershell -Command \"Get-Service WinRM; winrm enumerate winrm/config/listener\"",
                "rollback": None
            },
            {
                "action": "enable_winrm",
                "description": "Enable PS Remoting and confirm WinRM is listening",
                "command": "powershell -Command \"Enable-PSRemoting -Force; Get-Service WinRM\"",
                "rollback": "powershell -Command \"Disable-PSRemoting -Force\""
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-openssh-server-disabled",
        "title": "OpenSSH Server is not running on the Windows node",
        "keywords": ["OpenSSH", "sshd windows", "Add-WindowsCapability", "ssh windows node"],
        "root_cause": "Windows Server 2019/2022 ships OpenSSH as an optional capability. If the server component is not installed and started, ssh-based automation fails.",
        "remediation": [
            {
                "action": "check_ssh",
                "description": "Check whether OpenSSH Server is installed and running",
                "command": "powershell -Command \"Get-WindowsCapability -Online -Name OpenSSH.Server* | Select-Object Name, State; Get-Service sshd -ErrorAction SilentlyContinue\"",
                "rollback": None
            },
            {
                "action": "install_ssh",
                "description": "Install and start OpenSSH Server",
                "command": "powershell -Command \"Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Set-Service sshd -StartupType Automatic; Start-Service sshd\"",
                "rollback": "powershell -Command \"Stop-Service sshd; Remove-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0\""
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-rdp-firewall",
        "title": "RDP is blocked and prevents manual intervention",
        "keywords": ["RDP", "3389", "Remote Desktop", "New-NetFirewallRule 3389"],
        "root_cause": "RDP is blocked by default. During incident response, being unable to reach the node interactively makes recovery much harder.",
        "remediation": [
            {
                "action": "check_rdp",
                "description": "Check RDP listener and firewall rule state",
                "command": "powershell -Command \"Get-NetTCPConnection -LocalPort 3389 -State Listen -ErrorAction SilentlyContinue; Get-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue\"",
                "rollback": None
            },
            {
                "action": "enable_rdp_rule",
                "description": "Enable the built-in Remote Desktop firewall rules (only from trusted management networks)",
                "command": "powershell -Command \"Get-NetFirewallRule -DisplayGroup 'Remote Desktop' | Enable-NetFirewallRule\"",
                "rollback": "powershell -Command \"Get-NetFirewallRule -DisplayGroup 'Remote Desktop' | Disable-NetFirewallRule\""
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-remote-managment-scope",
        "title": "Windows Firewall RemoteAddress scope blocks management access",
        "keywords": ["RemoteAddress", "Set-NetFirewallRule", "scope", "management subnet", "windows firewall scope"],
        "root_cause": "Rules that allow kubelet or RDP only from LocalSubnet reject management traffic from other subnets, producing confusing intermittent connectivity during automation.",
        "remediation": [
            {
                "action": "inspect_scopes",
                "description": "Show RemoteAddress scopes on the relevant rules",
                "command": "powershell -Command \"Get-NetFirewallRule -Enabled True | Where-Object DisplayName -match 'kube|RDP|Kubernetes' | ForEach-Object { Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $_ }\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Widen the scope only to the required management networks",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-overlay-vfp-binding",
        "title": "VFP is not bound to the vSwitch used for overlay networking",
        "keywords": ["VFP binding", "Get-VMSwitchExtension", "vSwitch binding", "windows overlay binding"],
        "root_cause": "VFP must be bound to the vSwitch used for CNI overlay traffic. If the binding is missing, HNS cannot apply policies or encapsulate traffic correctly.",
        "remediation": [
            {
                "action": "check_binding",
                "description": "List vSwitches and their extensions",
                "command": "powershell -Command \"Get-VMSwitch | Format-List Name, SwitchType, Extensions\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Rebind VFP using the documented Windows networking commands or reinstall the networking features",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-kube-proxy-hns-dsr",
        "title": "kube-proxy DSR on Windows is not supported and silently breaks traffic",
        "keywords": ["DSR", "kube-proxy DSR windows", "direct server return", "windows kube-proxy"],
        "root_cause": "Windows does not implement DSR the way Linux does. Enabling DSR on kube-proxy for Windows nodes produces traffic that appears up but does not route correctly.",
        "remediation": [
            {
                "action": "inspect_kube_proxy_config",
                "description": "Check kube-proxy mode and DSR settings",
                "command": "kubectl -n kube-system get cm kube-proxy -o yaml | grep -iE 'mode|dsr|strictARP'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Use the kube-proxy mode documented for Windows nodes; disable DSR",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-nodeport-snat-loop",
        "title": "NodePort SNAT loop prevents service return traffic",
        "keywords": ["SNAT", "NodePort loop", "windows kube-proxy snat", "hairpin windows"],
        "root_cause": "Windows kube-proxy may SNAT NodePort traffic to the client IP in ways that break return routing when the client is itself a pod on the same node.",
        "remediation": [
            {
                "action": "inspect_hns_policies",
                "description": "List HNS policies related to the service in question",
                "command": "powershell -Command \"Get-HnsPolicyList | Where-Object { $_.Name -match '<service>' }\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Test access from a pod and from an external client to isolate the failure; adjust SNAT per kube-proxy documentation",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-mount-symlinks",
        "title": "Windows volume mounts fail on reparse points or symlinks",
        "keywords": ["reparse point", "symlink windows", "mount failure windows", "windows volume mount"],
        "root_cause": "Windows containers cannot always traverse reparse points or symlinks the same way as Linux. Volumes or subPaths pointing at reparse points can fail to mount.",
        "remediation": [
            {
                "action": "inspect_path",
                "description": "Check the target path for reparse points",
                "command": "powershell -Command \"Get-Item <path> | Select-Object FullName, Attributes, LinkType, Target\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Use a real directory rather than a reparse point for the volume or subPath",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-container-storage-depletion",
        "title": "Windows container storage is filling the node disk",
        "keywords": ["windows container storage", "C:\\ProgramData\\containerd", "windows disk full", "container layer windows"],
        "root_cause": "Windows container layers and the containerd content store can quickly consume C:\\ProgramData. When the C: drive fills, kubelet and HNS fail.",
        "remediation": [
            {
                "action": "measure_storage",
                "description": "Measure container and kubelet storage usage",
                "command": "powershell -Command \"Get-PSDrive C; Get-ChildItem C:\\ProgramData\\containerd -Recurse -ErrorAction SilentlyContinue | Measure-Object Length -Sum | Select-Object Count, Sum\"",
                "rollback": None
            },
            {
                "action": "prune_images",
                "description": "Prune unused Windows container images",
                "command": "powershell -Command \"ctr -n k8s.io images list -q | ForEach-Object { ctr -n k8s.io images remove $_ }\"",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-image-gc-disabled",
        "title": "Windows kubelet image garbage collection is not running",
        "keywords": ["image GC windows", "kubelet imagefs", "HighThresholdPercent", "windows image cleanup"],
        "root_cause": "kubelet's image GC relies on imagefs reporting. On Windows, if the imagefs information is missing or wrong, unused images accumulate and the disk fills.",
        "remediation": [
            {
                "action": "check_imagefs",
                "description": "Check imagefs reported by crictl",
                "command": "powershell -Command \"crictl info 2>$null | Select-String -Pattern 'imagefs|imageFs'\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Align image GC thresholds with the node's capacity; ensure containerd reports imagefs correctly",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-defender-application-control",
        "title": "WDAC or AppLocker blocks kubelet or containerd binaries",
        "keywords": ["WDAC", "AppLocker", "code integrity", "windows security policy containers"],
        "root_cause": "Windows Defender Application Control (WDAC) and AppLocker can block container binaries or kubelet helpers. Failures look like missing binaries or 'access denied' errors.",
        "remediation": [
            {
                "action": "check_code_integrity",
                "description": "Check the CodeIntegrity event log for blocked binaries",
                "command": "powershell -Command \"Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 40 -ErrorAction SilentlyContinue | Format-Table TimeCreated, Id, Message -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Add the container runtime binaries and their dependencies to the allowlist per enterprise policy",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-credential-guard-hvci",
        "title": "Credential Guard or HVCI interferes with Hyper-V isolation",
        "keywords": ["Credential Guard", "HVCI", "Virtualization-based security", "hyper-v isolation windows"],
        "root_cause": "VBS/HVCI changes how Hyper-V isolation behaves and can conflict with running VMs under container isolation, producing container creation failures on Windows nodes.",
        "remediation": [
            {
                "action": "check_vbs",
                "description": "Check VBS/HVCI state",
                "command": "powershell -Command \"Get-CimInstance -ClassName Win32_DeviceGuard -Namespace root\\Microsoft\\Windows\\DeviceGuard | Select-Object -Property SecurityServicesConfigured, SecurityServicesRunning, VirtualizationBasedSecurityStatus\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Reconcile the enterprise security baseline with the Hyper-V isolation requirements of the Windows workloads",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-kubelet-pod-ip-duplicate-after-clone",
        "title": "Windows node clone causes duplicate pod IPs",
        "keywords": ["clone windows", "hns state clone", "duplicate IP clone", "windows node cloned"],
        "root_cause": "Cloning a Windows VM copies HNS state, certificates, and node identity. The clone registers as the same node and reuses pod IPs, producing duplicate endpoints in the cluster.",
        "remediation": [
            {
                "action": "verify_identity",
                "description": "Confirm node identity, HNS state, and certificates",
                "command": "powershell -Command \"hostname; Get-ChildItem C:\\etc\\kubernetes -ErrorAction SilentlyContinue; Get-HnsNetwork\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Run sysprep / generalize on the clone, then rejoin with a new hostname and certificates",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-sysprep-generalize",
        "title": "Windows node was not sysprepped before cloning",
        "keywords": ["sysprep", "generalize", "windows clone prep", "duplicate SID"],
        "root_cause": "Windows VMs must be sysprepped with /generalize before cloning, otherwise SIDs, certificates, and host identity are duplicated and nodes collide in the cluster.",
        "remediation": [
            {
                "action": "check_sysprep",
                "description": "Check the Sysprep state and SIDs",
                "command": "powershell -Command \"Get-CimInstance Win32_ComputerSystemProduct | Select-Object UUID; whoami /user\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Recreate the node from a sysprepped image rather than trying to fix a duplicated identity in place",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-machine-password-not-reset",
        "title": "Windows machine account password was not reset after cloning",
        "keywords": ["machine account password", "Reset-ComputerMachinePassword", "domain join clone", "windows domain node"],
        "root_cause": "Domain-joined Windows nodes cloned without resetting their machine account password conflict on the domain, causing intermittent Kerberos failures that break GMSA and API authentication.",
        "remediation": [
            {
                "action": "check_domain",
                "description": "Check domain join state and machine account",
                "command": "powershell -Command \"Get-ComputerInfo -Property CsDomain, CsDomainRole; Test-ComputerSecureChannel -Verbose\"",
                "rollback": None
            },
            {
                "action": "reset_machine_password",
                "description": "Reset the machine account password and verify the secure channel",
                "command": "powershell -Command \"Reset-ComputerMachinePassword -Credential (Get-Credential); Test-ComputerSecureChannel\"",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-nodes-missing-coredns-on-windows",
        "title": "Windows pods cannot resolve cluster DNS",
        "keywords": ["windows coredns", "windows dns pod", "dns windows pod", "windows resolv.conf"],
        "root_cause": "Windows pods use the node DNS configuration and forward cluster DNS to CoreDNS. If Windows DNS client policy or the pod's DNS settings are wrong, only Windows pods experience DNS failures.",
        "remediation": [
            {
                "action": "test_dns_from_windows_pod",
                "description": "Run a DNS lookup inside a Windows pod",
                "command": "kubectl exec -it <windows-pod> -n <ns> -- nslookup kubernetes.default.svc.cluster.local",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Fix the pod's dnsPolicy/dnsConfig or node DNS per the Windows documentation",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-pod-dns-policy-default",
        "title": "Windows pod uses Default dnsPolicy and cannot resolve cluster services",
        "keywords": ["dnsPolicy Default windows", "windows pod dns", "clusterfirst windows", "windows dns policy"],
        "root_cause": "Windows pods using dnsPolicy Default inherit the host's resolver, not CoreDNS. Cluster service names cannot be resolved as a result.",
        "remediation": [
            {
                "action": "inspect_dns_policy",
                "description": "Show the pod's DNS policy",
                "command": "kubectl get pod <pod> -n <ns> -o jsonpath='{.spec.dnsPolicy}{\"\\n\"}'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Prefer dnsPolicy ClusterFirst unless host DNS is intentionally required",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-scheduler-preferred-not-met",
        "title": "Windows pods are scheduled onto Linux nodes",
        "keywords": ["windows pod on linux", "nodeSelector missing windows", "scheduler windows", "windows pod failed"],
        "root_cause": "Without nodeSelector kubernetes.io/os=windows, Windows pods may be scheduled onto Linux nodes where the Windows image cannot run, producing ImagePullBackOff or runtime failures.",
        "remediation": [
            {
                "action": "inspect_spec",
                "description": "Check pod nodeSelector and tolerations",
                "command": "kubectl get pod <pod> -n <ns> -o jsonpath='{.spec.nodeSelector}{\"\\n\"}{.spec.tolerations}{\"\\n\"}'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Add kubernetes.io/os=windows nodeSelector and appropriate taints/tolerations",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-node-taint-windows",
        "title": "Windows nodes lack the standard taint and Linux workloads land on them",
        "keywords": ["windows taint", "kubernetes.io/os windows taint", "NoSchedule windows", "linux pod on windows"],
        "root_cause": "Without a Windows-OS taint, Linux pods can be scheduled onto Windows nodes where they cannot run, and workloads become stuck.",
        "remediation": [
            {
                "action": "inspect_taints",
                "description": "List node taints",
                "command": "kubectl describe node <windows-node> | sed -n '/Taints/,/Unschedulable/p'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Apply a NoSchedule taint for Windows nodes so Linux pods avoid them",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-https-certificate-san",
        "title": "kubelet serving certificate on Windows is missing SANs",
        "keywords": ["kubelet serving certificate", "SAN", "kubelet TLS windows", "10250 certificate"],
        "root_cause": "The kubelet serving certificate must include SANs for the node's IPs and hostnames. Missing SANs cause API-server-to-kubelet TLS failures that break kubectl logs and exec.",
        "remediation": [
            {
                "action": "inspect_kubelet_cert",
                "description": "Show SANs on the kubelet serving certificate",
                "command": "powershell -Command \"$c = Get-ChildItem Cert:\\LocalMachine\\My | Where-Object Subject -match 'kubelet'; $c | Format-List Subject, DnsNameList, NotAfter\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Regenerate the kubelet serving certificate with the required SANs",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-kubelet-kubelet-conf-permissions",
        "title": "Windows kubelet cannot read its kubeconfig due to ACLs",
        "keywords": ["ACL", "file permissions kubelet windows", "Get-Acl", "kubelet kubeconfig permissions"],
        "root_cause": "Windows ACLs on C:\\etc\\kubernetes\\kubelet.conf may not grant read access to the kubelet service account, causing startup or rotation failure.",
        "remediation": [
            {
                "action": "inspect_acl",
                "description": "Inspect ACLs on the kubelet kubeconfig",
                "command": "powershell -Command \"Get-Acl C:\\etc\\kubernetes\\kubelet.conf | Format-List\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Grant read access to the kubelet service account while keeping ACLs restrictive",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-container-os-managed-image-update",
        "title": "Windows container base image patched on the node, but not on the control plane",
        "keywords": ["container base image", "windows patch cycle", "image mismatch", "windows container patch"],
        "root_cause": "Windows container base images are tied to host patch levels. Patching the node without updating the workload's base image causes process-isolation incompatibility at container start.",
        "remediation": [
            {
                "action": "check_versions",
                "description": "Compare host build and container image version",
                "command": "powershell -Command \"(Get-CimInstance Win32_OperatingSystem).Version; docker images\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Coordinate Windows node patching with workload image updates so process isolation continues to work",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-runtime-restart-policy",
        "title": "Windows kubelet and containerd services restart each other in a loop",
        "keywords": ["service dependency loop", "Recovery options", "sc.exe failure", "windows service loop"],
        "root_cause": "Misconfigured SCM recovery options on kubelet and containerd can create a restart storm where each service triggers the other's failure path.",
        "remediation": [
            {
                "action": "inspect_recovery",
                "description": "Show SCM failure/recovery settings on both services",
                "command": "sc.exe qfailure kubelet; sc.exe qfailure containerd",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Align recovery options with the documentation and fix the underlying failure; do not tune recovery to hide crashes",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-hostports-port-owner",
        "title": "Windows pod cannot bind its hostPort",
        "keywords": ["hostPort windows", "port in use windows", "Get-NetTCPConnection", "windows hostport"],
        "root_cause": "On Windows, hostPort bindings are enforced by the runtime/HNS. Another service or a stale HNS policy holding the port prevents the pod from starting.",
        "remediation": [
            {
                "action": "find_owner",
                "description": "Identify the process or policy holding the port",
                "command": "powershell -Command \"Get-NetTCPConnection -LocalPort <port> -ErrorAction SilentlyContinue | Format-Table LocalAddress, LocalPort, OwningProcess, State -AutoSize; Get-HnsPolicyList | Where-Object { $_.Name -match '<port>' }\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Free the port or clean stale HNS policies via the CNI plugin's documented procedure",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-node-taint-windows-unschedulable",
        "title": "Windows node is marked unschedulable",
        "keywords": ["windows unschedulable", "cordon windows", "SchedulingDisabled windows", "kubectl uncordon windows"],
        "root_cause": "After maintenance or upgrades, Windows nodes may be left cordoned. Windows workloads then cannot schedule and stay Pending.",
        "remediation": [
            {
                "action": "check_node",
                "description": "Show scheduling state for the node",
                "command": "kubectl get nodes | grep -i windows; kubectl get node <windows-node> -o jsonpath='{.spec.unschedulable}{\"\\n\"}'",
                "rollback": None
            },
            {
                "action": "uncordon_node",
                "description": "Return the node to service",
                "command": "kubectl uncordon <windows-node>",
                "rollback": "kubectl cordon <windows-node>"
            }
        ],
        "risk_level": "low"
    },
    {
        "id": "windows-kubelet-drain-stuck",
        "title": "kubectl drain on a Windows node gets stuck",
        "keywords": ["drain windows", "kubectl drain stuck", "eviction windows", "windows drain"],
        "root_cause": "Windows pods with non-evictable volumes, hostPort conflicts, or DaemonSets that must run on every node can prevent drain from completing.",
        "remediation": [
            {
                "action": "inspect_evictions",
                "description": "Read drain output and check for stuck evictions",
                "command": "kubectl get pods -A --field-selector spec.nodeName=<windows-node> | grep -v Completed",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Handle PDBs and daemonsets appropriately; use --ignore-daemonsets and --force only when justified",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-containerd-upgrade-skew",
        "title": "Windows containerd version is out of skew with kubelet",
        "keywords": ["containerd version windows", "runtime skew", "windows runtime upgrade", "containerd kubelet windows"],
        "root_cause": "Newer kubelet features on Windows rely on container runtime features (HostProcess, CSI Proxy integration). Skewed runtime versions cause pods to fail in specific scenarios.",
        "remediation": [
            {
                "action": "check_versions",
                "description": "Show containerd and kubelet versions",
                "command": "powershell -Command \"containerd --version; kubelet --version\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Align containerd with the documented version for the Kubernetes release",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-windows-update-breaks-hns",
        "title": "Windows cumulative update breaks HNS after reboot",
        "keywords": ["windows update HNS", "cumulative update break", "windows node update", "hns after update"],
        "root_cause": "Some Windows cumulative updates change HNS internals or VFP behavior. Existing HNS networks and VFP bindings may not be recreated cleanly, breaking overlay networking.",
        "remediation": [
            {
                "action": "inspect_hns_after_update",
                "description": "Check HNS networks and VFP bindings after the update",
                "command": "powershell -Command \"Get-HnsNetwork; Get-VMSwitch | Format-Table Name, SwitchType, Extensions -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Recreate HNS state via the CNI plugin's documented procedure if HNS networks are missing after the update",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-kubelet-nodeport-service-connectivity",
        "title": "NodePort service is unreachable from outside the Windows node",
        "keywords": ["NodePort windows external", "windows nodeport unreachable", "windows service access"],
        "root_cause": "Windows NodePort access depends on kube-proxy HNS policies and firewall rules. Either missing HNS policies or the firewall blocking the port range produces 'connection refused' externally.",
        "remediation": [
            {
                "action": "inspect_hns_and_firewall",
                "description": "Check HNS policies and firewall rules for the port",
                "command": "powershell -Command \"Get-HnsPolicyList | Where-Object { $_.Name -match '<port>' }; Get-NetFirewallRule -Enabled True | Where-Object DisplayName -match 'nodeport|kubernetes'\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Fix kube-proxy policy creation or open the required inbound firewall port",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-cluster-loadbalancer-no-ccm",
        "title": "LoadBalancer services on Windows stay Pending without a cloud controller",
        "keywords": ["LoadBalancer windows pending", "cloud controller", "windows service type", "no external ip"],
        "root_cause": "Without a cloud controller manager or a bare-metal implementation such as MetalLB, LoadBalancer services on Windows nodes remain Pending and have no external IP.",
        "remediation": [
            {
                "action": "inspect_service",
                "description": "Inspect the Service and events",
                "command": "kubectl get svc <svc> -n <ns> -o wide; kubectl describe svc <svc> -n <ns> | tail -40",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Install a compatible load balancer implementation or use NodePort/external ingress",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-container-user-nonadmin",
        "title": "Windows container runs as a non-admin user and fails",
        "keywords": ["ContainerUser", "ContainerAdministrator", "windows container user", "runAsUser windows"],
        "root_cause": "Windows containers default to ContainerUser or ContainerAdministrator depending on the image. Windows workloads that need admin-level access fail when the image defaults to ContainerUser.",
        "remediation": [
            {
                "action": "inspect_user",
                "description": "Check the container's user configuration",
                "command": "kubectl get pod <pod> -n <ns> -o jsonpath='{.spec.containers[*].securityContext}{\"\\n\"}'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Set the correct securityContext or use an image built for the intended user",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-proxy-image-not-set",
        "title": "Windows kube-proxy image is missing from the manifest or node",
        "keywords": ["kube-proxy windows image", "proxy image missing", "windows kube-proxy daemonset", "windows proxy image"],
        "root_cause": "kube-proxy DaemonSet uses different images for Linux and Windows. Missing Windows image or node label selector prevents the Windows kube-proxy pod from running.",
        "remediation": [
            {
                "action": "inspect_daemonset",
                "description": "Inspect the kube-proxy DaemonSet and its node selectors",
                "command": "kubectl -n kube-system get ds kube-proxy -o yaml | grep -A5 -iE 'nodeSelector|image:|kubernetes.io/os'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Ensure the DaemonSet has the correct Windows image and nodeSelector and that the image is pullable",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-kubelet-node-notready-no-hns",
        "title": "Windows node is NotReady because HNS reports no networking",
        "keywords": ["windows NotReady", "HNS down", "NetworkPluginNotReady windows", "windows node notready"],
        "root_cause": "When HNS cannot create or enumerate the pod network, kubelet reports NetworkPluginNotReady and the node stays NotReady. This is often caused by stopped HNS, corrupted HNS state, or missing VFP.",
        "remediation": [
            {
                "action": "check_hns_and_vfp",
                "description": "Check HNS, VFP, and node conditions",
                "command": "powershell -Command \"Get-Service hns; Get-HnsNetwork; Get-VMSwitch | Format-Table Name, SwitchType, Extensions -AutoSize\"; kubectl describe node <windows-node> | sed -n '/Conditions/,/Addresses/p'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Repair HNS/VFP via the documented Windows networking procedure, then restart kubelet and containerd",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "windows-kubelet-hns-endpoint-list-storm",
        "title": "HNS endpoint list grows unbounded",
        "keywords": ["hns endpoints leak", "Get-HnsEndpoint count", "windows endpoint leak", "windows pod cleanup"],
        "root_cause": "Failing pods or CNI cleanup gaps can leave HNS endpoints behind. Over time this consumes resources and can exceed HNS limits, causing new pod creation to fail.",
        "remediation": [
            {
                "action": "count_endpoints",
                "description": "Count HNS endpoints and correlate with active pods",
                "command": "powershell -Command \"(Get-HnsEndpoint).Count; kubectl get pods -A --field-selector spec.nodeName=<windows-node> | wc -l\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Clean leaked endpoints using the CNI plugin's documented procedure",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "windows-kubelet-hns-port-mapping-leak",
        "title": "HNS port mappings accumulate and slow policy programming",
        "keywords": ["hns port mapping", "Get-HnsPortMapping", "windows port mapping leak", "hns policy performance"],
        "root_cause": "Some CNI operations create HNS port mappings that are not cleaned up. Their accumulation slows HNS policy programming and can confuse Service routing on the node.",
        "remediation": [
            {
                "action": "list_mappings",
                "description": "List current HNS port mappings",
                "command": "powershell -Command \"Get-HnsPortMapping -ErrorAction SilentlyContinue | Format-Table Name, Protocol, InternalPort, ExternalPort -AutoSize\"",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Follow the CNI plugin's documented cleanup procedure for stale mappings",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },

    # ============================================================
    # NEW RECORDS — Linux / general Kubernetes operational scenarios
    # ============================================================

    {
        "id": "linux-kubelet-cni-config-missing",
        "title": "kubelet reports NetworkPluginNotReady because /etc/cni/net.d is empty",
        "keywords": ["NetworkPluginNotReady", "cni config uninitialized", "cni config missing", "NotReady kubelet", "/etc/cni/net.d empty", "FailedCreatePodSandBox"],
        "root_cause": "kubelet requires a valid CNI configuration under /etc/cni/net.d. If the CNI manifest pod failed to install (RBAC, image pull, or scheduling issue), no configuration file is written, kubelet reports NetworkPluginNotReady and every pod stays in ContainerCreating.",
        "remediation": [
            {
                "action": "confirm_symptom",
                "description": "Confirm the node condition and CNI directory state",
                "command": "kubectl describe node <node> | sed -n '/Conditions/,/Addresses/p'; sudo ls -la /etc/cni/net.d/",
                "rollback": None
            },
            {
                "action": "inspect_cni_pods",
                "description": "Inspect CNI DaemonSet pods scheduled to the failing node",
                "command": "kubectl -n kube-system get pods -o wide --field-selector spec.nodeName=<node> | grep -iE 'calico|cilium|flannel|canal|weave'",
                "rollback": None
            },
            {
                "action": "restart_kubelet",
                "description": "After the CNI pod is healthy and writes the config, restart kubelet to reload",
                "command": "sudo systemctl restart kubelet",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubelet-failed-create-pod-sandbox",
        "title": "Pod stuck in ContainerCreating with FailedCreatePodSandBox",
        "keywords": ["FailedCreatePodSandBox", "ContainerCreating", "pod sandbox creation failed", "cni plugin error"],
        "root_cause": "The runtime cannot create a network namespace for the pod because the CNI plugin returned an error (missing IPAM state, subnet exhaustion, or plugin binary missing). kubelet emits FailedCreatePodSandBox events with the underlying CNI message.",
        "remediation": [
            {
                "action": "read_events",
                "description": "Read the pod events for the CNI error text",
                "command": "kubectl describe pod <pod> -n <ns> | sed -n '/Events/,$p'",
                "rollback": None
            },
            {
                "action": "check_cni_binaries",
                "description": "Confirm CNI plugin binaries exist",
                "command": "sudo ls -la /opt/cni/bin/",
                "rollback": None
            },
            {
                "action": "check_cni_logs",
                "description": "Inspect the CNI daemon logs on that node",
                "command": "sudo journalctl -u kubelet --since '10 min ago' | grep -iE 'cni|sandbox'",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubeadm-preflight-swap-enabled",
        "title": "kubeadm init or join fails preflight because swap is enabled",
        "keywords": ["kubeadm preflight", "swap enabled", "swapoff -a", "kubeadm init failed", "kubeadm join failed"],
        "root_cause": "kubelet refuses to run with swap enabled unless explicitly configured. kubeadm preflight checks detect active swap and abort before writing any cluster state.",
        "remediation": [
            {
                "action": "check_swap",
                "description": "Show active swap devices",
                "command": "swapon --show; free -h",
                "rollback": None
            },
            {
                "action": "disable_swap_runtime",
                "description": "Disable swap at runtime",
                "command": "sudo swapoff -a",
                "rollback": "sudo swapon -a"
            },
            {
                "action": "disable_swap_persistent",
                "description": "Comment out swap entries in /etc/fstab to survive reboot",
                "command": "sudo sed -i.bak -E '/\\sswap\\s/s/^/#/' /etc/fstab",
                "rollback": "sudo cp /etc/fstab.bak /etc/fstab"
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubeadm-preflight-port-in-use",
        "title": "kubeadm preflight fails because a control-plane port is in use",
        "keywords": ["kubeadm preflight", "port 6443 in use", "port 10250 in use", "etcd 2379 in use", "kubeadm port conflict"],
        "root_cause": "A stale kubelet, an earlier control plane, or an unrelated service is listening on one of the required control-plane ports. kubeadm preflight aborts to avoid corrupting an existing cluster.",
        "remediation": [
            {
                "action": "find_listener",
                "description": "Identify the process listening on the conflicting port",
                "command": "sudo ss -lntp | grep -E ':(6443|2379|2380|10250|10257|10259)\\b'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "If a previous kubeadm/cluster install owns the ports, decide whether to reset it or choose a different node",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-kubeadm-join-token-expired",
        "title": "kubeadm join fails because the bootstrap token expired",
        "keywords": ["kubeadm join", "token expired", "bootstrap token", "node not found", "kubeadm token create"],
        "root_cause": "Bootstrap tokens default to 24h TTL. A join performed after the token expired is rejected by the API server even though the token string is valid in the local command.",
        "remediation": [
            {
                "action": "list_tokens",
                "description": "List remaining bootstrap tokens on the control plane",
                "command": "sudo kubeadm token list",
                "rollback": None
            },
            {
                "action": "create_new_token",
                "description": "Create a fresh token and print the join command",
                "command": "sudo kubeadm token create --print-join-command",
                "rollback": None
            }
        ],
        "risk_level": "low"
    },
    {
        "id": "linux-kubeadm-ca-hash-mismatch",
        "title": "kubeadm join fails because the CA cert hash is wrong",
        "keywords": ["kubeadm join", "ca cert hash", "discovery-token-ca-cert-hash", "x509: certificate signed by unknown authority", "kubeadm join tls"],
        "root_cause": "The --discovery-token-ca-cert-hash on the joining node does not match the cluster CA. Typically caused by using a hash from a different cluster or after CA rotation.",
        "remediation": [
            {
                "action": "recompute_hash",
                "description": "Recompute the CA cert hash on the control plane",
                "command": "sudo openssl x509 -pubkey -in /etc/kubernetes/pki/ca.crt | openssl rsa -pubin -outform der 2>/dev/null | openssl dgst -sha256 -hex | sed 's/^.* //'",
                "rollback": None
            },
            {
                "action": "rejoin",
                "description": "Run kubeadm join again with the correct hash",
                "command": "sudo kubeadm join <control-plane>:6443 --token <token> --discovery-token-ca-cert-hash sha256:<hash>",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubeadm-init-cri-socket-missing",
        "title": "kubeadm init aborts because the CRI socket is not detected",
        "keywords": ["kubeadm init", "cri socket", "no runtime detected", "--cri-socket", "containerd.sock missing", "cri-dockerd.sock"],
        "root_cause": "kubeadm autodetects the container runtime by probing known sockets. If containerd or cri-dockerd is not running or uses a non-default socket, kubeadm aborts with 'no CRI socket detected'.",
        "remediation": [
            {
                "action": "check_runtime",
                "description": "Confirm the runtime service and socket",
                "command": "sudo systemctl status containerd --no-pager; ls -la /run/containerd/containerd.sock /var/run/cri-dockerd.sock 2>/dev/null",
                "rollback": None
            },
            {
                "action": "retry_with_socket",
                "description": "Retry kubeadm with an explicit --cri-socket",
                "command": "sudo kubeadm init --cri-socket unix:///run/containerd/containerd.sock",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-containerd-cri-disabled",
        "title": "containerd CRI plugin is disabled so kubelet cannot reach it",
        "keywords": ["containerd cri disabled", "io.containerd.grpc.v1.cri", "disabled_plugins", "containerd config", "kubelet runtime not ready"],
        "root_cause": "Some packages ship containerd with the CRI plugin disabled. kubelet then reports 'container runtime not ready' and no pods can start even though containerd is running.",
        "remediation": [
            {
                "action": "inspect_config",
                "description": "Check containerd config for disabled CRI plugin",
                "command": "sudo containerd config dump | grep -i disabled_plugins",
                "rollback": None
            },
            {
                "action": "enable_cri",
                "description": "Remove the CRI plugin from disabled_plugins and restart containerd",
                "command": "sudo sed -i.bak 's/^disabled_plugins.*/# disabled_plugins = []/' /etc/containerd/config.toml; sudo systemctl restart containerd",
                "rollback": "sudo cp /etc/containerd/config.toml.bak /etc/containerd/config.toml; sudo systemctl restart containerd"
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-kubelet-cgroup-driver-mismatch",
        "title": "kubelet cgroup driver does not match the container runtime",
        "keywords": ["cgroup driver mismatch", "systemd cgroupfs", "kubelet failed to run", "cgroup driver", "containerd SystemdCgroup"],
        "root_cause": "kubelet defaulted to cgroupfs while containerd is configured with SystemdCgroup = true (or the reverse). This produces node instability and repeated kubelet restarts on modern systemd distributions.",
        "remediation": [
            {
                "action": "check_runtime_cgroup",
                "description": "Check the runtime cgroup driver",
                "command": "sudo containerd config dump | grep -i SystemdCgroup",
                "rollback": None
            },
            {
                "action": "align_kubelet",
                "description": "Set kubelet cgroupDriver=systemd in KubeletConfiguration and restart",
                "command": "sudo sed -i 's/cgroupDriver:.*/cgroupDriver: systemd/' /var/lib/kubelet/config.yaml; sudo systemctl restart kubelet",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-kubelet-cgroupv2-single-process",
        "title": "Node runs cgroup v2 and old kubelet/runtime is not compatible",
        "keywords": ["cgroup v2", "cgroupv2", "unified hierarchy", "kubelet cgroupv2", "systemd cgroup v2"],
        "root_cause": "Recent distributions boot with cgroup v2 by default. Older kubelet or containerd versions do not fully support v2, causing pods to fail with resource or accounting errors.",
        "remediation": [
            {
                "action": "check_cgroup_version",
                "description": "Determine which cgroup hierarchy is in use",
                "command": "stat -fc %T /sys/fs/cgroup/",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Upgrade kubelet and containerd to versions with cgroup v2 support or boot with systemd.unified_cgroup_hierarchy=0 if the vendor supports v1",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-kubelet-swap-enabled-systemd",
        "title": "kubelet fails to start because swap is enabled",
        "keywords": ["kubelet swap", "Failed to start kubelet", "swap enabled", "kubelet service failed"],
        "root_cause": "By default kubelet fails to start when swap is enabled, unless the NodeSwap feature is explicitly configured. On freshly imaged VMs swap may be enabled by the base image.",
        "remediation": [
            {
                "action": "check_swap",
                "description": "Check active swap",
                "command": "swapon --show",
                "rollback": None
            },
            {
                "action": "disable_swap",
                "description": "Disable swap at runtime and remove from fstab",
                "command": "sudo swapoff -a; sudo sed -i.bak -E '/\\sswap\\s/s/^/#/' /etc/fstab; sudo systemctl restart kubelet",
                "rollback": "sudo cp /etc/fstab.bak /etc/fstab; sudo swapon -a; sudo systemctl restart kubelet"
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubelet-node-unknown-api-unreachable",
        "title": "Node transitions to Unknown because kubelet cannot reach the API server",
        "keywords": ["node Unknown", "kubelet api unreachable", "connection refused 6443", "kubelet cannot reach apiserver"],
        "root_cause": "kubelet loses the ability to reach the API server (firewall change, wrong endpoint, dead control plane, or expired client certificate). After the node-monitor-grace-period the node is marked Unknown.",
        "remediation": [
            {
                "action": "check_connectivity",
                "description": "Test reachability to the API server from the node",
                "command": "curl -k https://<api-endpoint>:6443/healthz",
                "rollback": None
            },
            {
                "action": "check_kubelet_logs",
                "description": "Read recent kubelet errors",
                "command": "sudo journalctl -u kubelet --since '10 min ago' | tail -100",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubelet-certificate-expired",
        "title": "kubelet client certificate has expired",
        "keywords": ["kubelet certificate expired", "x509 expired", "kubelet.pem expired", "certificate has expired or is not yet valid"],
        "root_cause": "kubelet client certificates default to one year. If rotation is disabled or CSR approval failed, the certificate expires and kubelet is rejected by the API server.",
        "remediation": [
            {
                "action": "check_expiry",
                "description": "Show kubelet certificate dates",
                "command": "sudo openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem -noout -dates",
                "rollback": None
            },
            {
                "action": "approve_csr",
                "description": "Approve any pending kubelet-serving or kubelet-client CSRs",
                "command": "kubectl get csr | grep Pending; kubectl certificate approve <csr-name>",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-apiserver-etcd-connection-lost",
        "title": "kube-apiserver loses connection to etcd",
        "keywords": ["apiserver etcd", "context deadline exceeded", "etcdserver: request timed out", "apiserver not ready", "etcd dial timeout"],
        "root_cause": "kube-apiserver cannot reach etcd due to network, TLS, or endpoint mismatch. The apiserver marks itself unhealthy and kubectl commands fail cluster-wide.",
        "remediation": [
            {
                "action": "check_etcd_endpoint",
                "description": "Test connectivity from the control-plane node to etcd",
                "command": "sudo ss -lntp | grep 2379; curl -k https://127.0.0.1:2379/health",
                "rollback": None
            },
            {
                "action": "inspect_apiserver_logs",
                "description": "Read apiserver errors",
                "command": "sudo crictl logs $(sudo crictl ps --name kube-apiserver -q) 2>&1 | tail -100",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-etcd-space-quota-exceeded",
        "title": "etcd rejects writes with 'mvcc: database space exceeded'",
        "keywords": ["etcd space quota", "database space exceeded", "etcd NOSPACE", "etcd compaction", "etcd defrag"],
        "root_cause": "etcd enforces a default 2 GiB backend quota. Without periodic compaction and defragmentation the database exceeds the quota and all writes fail, blocking cluster changes.",
        "remediation": [
            {
                "action": "check_status",
                "description": "Check etcd DB size and alarm list",
                "command": "sudo ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key endpoint status --write-out=table; sudo ETCDCTL_API=3 etcdctl alarm list",
                "rollback": None
            },
            {
                "action": "compact_defrag",
                "description": "Compact the revision history and defragment the store, then disarm the NOSPACE alarm",
                "command": "REV=$(sudo ETCDCTL_API=3 etcdctl endpoint status --write-out=json | jq -r '.[0].Status.header.revision'); sudo ETCDCTL_API=3 etcdctl compact $REV; sudo ETCDCTL_API=3 etcdctl defrag; sudo ETCDCTL_API=3 etcdctl alarm disarm",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-etcd-peer-connectivity-failed",
        "title": "etcd member cannot reach peers and quorum is lost",
        "keywords": ["etcd peer", "etcdserver: no leader", "etcd quorum", "etcd member unreachable", "request timed out"],
        "root_cause": "etcd requires peer connectivity on 2380. Firewall changes, wrong advertise peer URLs, or an offline member drop the cluster below quorum and every API request fails.",
        "remediation": [
            {
                "action": "check_members",
                "description": "Inspect member list and health",
                "command": "sudo ETCDCTL_API=3 etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key member list -w table; sudo ETCDCTL_API=3 etcdctl endpoint health --cluster",
                "rollback": None
            },
            {
                "action": "check_peer_ports",
                "description": "Confirm peers can reach each other on 2379/2380",
                "command": "for p in <peer1> <peer2> <peer3>; do nc -vz $p 2380; done",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-etcd-slow-disk-fsync",
        "title": "etcd reports slow fsync and leader changes",
        "keywords": ["etcd slow fsync", "etcd disk latency", "leader changed", "took too long to execute", "etcd high latency"],
        "root_cause": "etcd is sensitive to fsync latency. Network storage, throttled cloud disks, or noisy neighbors on the disk increase write latency and trigger leader elections, destabilizing the control plane.",
        "remediation": [
            {
                "action": "measure_io",
                "description": "Measure disk latency on the etcd data directory",
                "command": "sudo fio --filename=/var/lib/etcd/fio.test --size=64m --rw=write --bs=8k --ioengine=libaio --iodepth=1 --name=etcd-io --direct=1 --runtime=30; sudo rm -f /var/lib/etcd/fio.test",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Move etcd to a dedicated local SSD; avoid network volumes for etcd",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-coredns-crashloop",
        "title": "CoreDNS pods are in CrashLoopBackOff",
        "keywords": ["coredns CrashLoopBackOff", "coredns loop detected", "plugin/loop", "coredns corefile", "CoreDNS-1.9"],
        "root_cause": "Common causes are a resolv.conf forwarding loop (the node resolver points at CoreDNS itself) or an invalid Corefile. CoreDNS refuses to start with a 'loop' plugin error.",
        "remediation": [
            {
                "action": "read_logs",
                "description": "Read CoreDNS logs for the plugin error",
                "command": "kubectl -n kube-system logs -l k8s-app=kube-dns --tail=120",
                "rollback": None
            },
            {
                "action": "check_resolv",
                "description": "Check the node's /etc/resolv.conf for the cluster DNS IP",
                "command": "cat /etc/resolv.conf",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Fix the node resolver or the Corefile forwarding target; do not blind-restart",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-nodelocaldns-loop",
        "title": "NodeLocal DNSCache forwards back to kube-dns and creates a loop",
        "keywords": ["nodelocaldns", "169.254.25.10", "nodelocaldns loop", "dns loop", "node local dns"],
        "root_cause": "If NodeLocal DNSCache is not running on a node while the kubelet resolv.conf still points at 169.254.25.10, pods fail DNS until the daemon is restored. A misconfigured forward back to the same address creates a loop.",
        "remediation": [
            {
                "action": "check_daemonset",
                "description": "Check NodeLocal DNSCache pods on all nodes",
                "command": "kubectl -n kube-system get pods -l k8s-app=node-local-dns -o wide",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Fix the Corefile 'forward' target and ensure node-local-dns runs on every node, or remove NodeLocal DNSCache consistently",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-coredns-upstream-unreachable",
        "title": "CoreDNS cannot reach upstream resolvers",
        "keywords": ["coredns upstream", "no upstream", "SERVFAIL coredns", "dns resolution external failed", "forward . /etc/resolv.conf"],
        "root_cause": "CoreDNS forwards external names to the node's upstream resolvers. Firewall blocks, wrong upstream, or a resolv.conf rewrite by cloud-init cause external DNS to fail while cluster-internal names still resolve.",
        "remediation": [
            {
                "action": "test_upstream",
                "description": "Test external resolution from the CoreDNS pod",
                "command": "kubectl -n kube-system exec -it $(kubectl -n kube-system get pods -l k8s-app=kube-dns -o jsonpath='{.items[0].metadata.name}') -- nslookup kubernetes.io",
                "rollback": None
            },
            {
                "action": "inspect_configmap",
                "description": "Inspect the CoreDNS Corefile forwarding configuration",
                "command": "kubectl -n kube-system get cm coredns -o yaml",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-systemd-resolved-stub-loop",
        "title": "systemd-resolved stub listener conflicts with cluster DNS",
        "keywords": ["systemd-resolved", "127.0.0.53", "resolved stub", "dns stub listener", "coredns loop systemd"],
        "root_cause": "systemd-resolved listens on 127.0.0.53 and rewrites /etc/resolv.conf to point at the stub. CoreDNS forwarding to /etc/resolv.conf then reaches the stub, which points at itself, causing SERVFAIL and loops.",
        "remediation": [
            {
                "action": "inspect_resolved",
                "description": "Show resolved stub state and current resolv.conf",
                "command": "resolvectl status 2>/dev/null || systemd-resolve --status; cat /etc/resolv.conf",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Disable the resolved stub or point kubelet/CoreDNS at a real upstream",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-iptables-nft-vs-legacy-conflict",
        "title": "iptables-nft and iptables-legacy are mixed on the node",
        "keywords": ["iptables-nft", "iptables-legacy", "update-alternatives iptables", "kube-proxy iptables mode", "nft rules missing"],
        "root_cause": "kube-proxy writes rules via the default iptables binary. If the system switched from legacy to nft (or vice versa), rules may be written to a backend that does not match the one the kernel uses for the packet path, causing Services to be unreachable.",
        "remediation": [
            {
                "action": "check_alternatives",
                "description": "Show the current iptables backend selection",
                "command": "sudo update-alternatives --display iptables; sudo iptables --version",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Standardize the backend across the node and restart kube-proxy",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-kube-proxy-iptables-lock-timeout",
        "title": "kube-proxy fails to program iptables because the xtables lock is held",
        "keywords": ["xtables lock", "another app is currently holding the xtables lock", "kube-proxy iptables error", "iptables lock"],
        "root_cause": "kube-proxy, a firewall agent, or a fail2ban-style tool can hold the xtables lock longer than kube-proxy's wait timeout, causing failed rule updates and stale service rules.",
        "remediation": [
            {
                "action": "read_kube_proxy_logs",
                "description": "Read kube-proxy logs for xtables lock errors",
                "command": "sudo journalctl -u kube-proxy --since '30 min ago' | grep -iE 'xtables|lock' | tail -50",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Identify the other process using iptables and serialize or remove it",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-nf-conntrack-table-full",
        "title": "nf_conntrack table is full and drops new connections",
        "keywords": ["nf_conntrack: table full", "conntrack full", "dropping packet", "nf_conntrack_count", "conntrack_max"],
        "root_cause": "The kernel conntrack table is a fixed-size hash. Under heavy Service and pod traffic the table can fill, and the kernel drops new connections with 'nf_conntrack: table full, dropping packet'.",
        "remediation": [
            {
                "action": "inspect_counts",
                "description": "Check current conntrack count versus max",
                "command": "cat /proc/sys/net/netfilter/nf_conntrack_count /proc/sys/net/netfilter/nf_conntrack_max; dmesg | tail -50 | grep -i conntrack",
                "rollback": None
            },
            {
                "action": "raise_max",
                "description": "Increase conntrack max for the node (persist via sysctl.d)",
                "command": "echo 'net.netfilter.nf_conntrack_max = 1048576' | sudo tee /etc/sysctl.d/99-conntrack.conf; sudo sysctl --system",
                "rollback": "sudo rm /etc/sysctl.d/99-conntrack.conf; sudo sysctl --system"
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-bridge-nf-call-iptables-disabled",
        "title": "net.bridge.bridge-nf-call-iptables is disabled and Service traffic is bypassed",
        "keywords": ["bridge-nf-call-iptables", "br_netfilter", "kube-proxy rules not applied", "packets bypass iptables"],
        "root_cause": "kube-proxy relies on netfilter seeing bridged traffic. If br_netfilter is not loaded or bridge-nf-call-iptables is 0, iptables rules for Services are bypassed for bridged pod traffic.",
        "remediation": [
            {
                "action": "check_sysctls",
                "description": "Show br_netfilter module and bridge call sysctls",
                "command": "lsmod | grep br_netfilter; sysctl net.bridge.bridge-nf-call-iptables net.bridge.bridge-nf-call-ip6tables",
                "rollback": None
            },
            {
                "action": "enable",
                "description": "Load br_netfilter and enable bridge call sysctls",
                "command": "sudo modprobe br_netfilter; printf 'net.bridge.bridge-nf-call-iptables = 1\\nnet.bridge.bridge-nf-call-ip6tables = 1\\n' | sudo tee /etc/sysctl.d/99-kubernetes-cri.conf; sudo sysctl --system",
                "rollback": "sudo rm /etc/sysctl.d/99-kubernetes-cri.conf; sudo sysctl --system"
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-ip-forward-disabled",
        "title": "net.ipv4.ip_forward is disabled on the node",
        "keywords": ["ip_forward", "net.ipv4.ip_forward=0", "forwarding disabled", "packet forwarding kubelet"],
        "root_cause": "kubelet requires IPv4 (and/or IPv6) forwarding to be enabled. When disabled, pod and Service traffic cannot be routed off the node.",
        "remediation": [
            {
                "action": "check_sysctl",
                "description": "Show current forwarding setting",
                "command": "sysctl net.ipv4.ip_forward net.ipv6.conf.all.forwarding",
                "rollback": None
            },
            {
                "action": "enable_forwarding",
                "description": "Enable forwarding and persist it",
                "command": "printf 'net.ipv4.ip_forward = 1\\nnet.ipv6.conf.all.forwarding = 1\\n' | sudo tee /etc/sysctl.d/99-kubernetes-forward.conf; sudo sysctl --system",
                "rollback": "sudo rm /etc/sysctl.d/99-kubernetes-forward.conf; sudo sysctl --system"
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-firewalld-blocks-pod-network",
        "title": "firewalld blocks pod-to-pod or node-to-pod traffic",
        "keywords": ["firewalld", "kubelet firewalld", "firewalld bridge", "pod network blocked firewalld", "firewall-cmd"],
        "root_cause": "firewalld's default zone does not allow bridged pod traffic or the CNI interfaces. This silently drops pod-to-pod and Service traffic, especially after a fresh RHEL/Rocky install.",
        "remediation": [
            {
                "action": "inspect_zones",
                "description": "Show active zones and interfaces",
                "command": "sudo firewall-cmd --get-active-zones; sudo firewall-cmd --list-all",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Allow the CNI interfaces and control-plane ports per the CNI vendor and platform documentation; avoid disabling firewalld globally",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-ufw-blocks-cni-and-nodeports",
        "title": "ufw blocks pod and NodePort traffic on Ubuntu nodes",
        "keywords": ["ufw", "ubuntu firewall", "ufw blocks nodeport", "ufw cni", "ufw pod traffic"],
        "root_cause": "Ubuntu's ufw default policy drops inbound traffic to NodePorts and can interfere with pod-to-pod VXLAN/IPIP traffic. Symptoms appear after enabling ufw during hardening.",
        "remediation": [
            {
                "action": "inspect_ufw",
                "description": "Show ufw state and rules",
                "command": "sudo ufw status verbose",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Add allow rules for the pod CIDR, Service CIDR, VXLAN (UDP 4789), IPIP, and required control-plane ports; keep default deny for the rest",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-selinux-blocks-kubelet-and-cni",
        "title": "SELinux denials break kubelet, containerd, or CNI",
        "keywords": ["SELinux", "AVC denial", "setenforce", "audit.log avc", "selinux container runtime"],
        "root_cause": "On enforcing systems, SELinux can deny container runtime writes, CNI state changes, or kubelet cert operations. Symptoms range from FailedCreatePodSandBox to node NotReady.",
        "remediation": [
            {
                "action": "check_mode_and_avc",
                "description": "Show SELinux mode and recent AVC denials",
                "command": "getenforce; sudo ausearch -m avc -ts recent | tail -50",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Apply the correct policy (container-selinux, cni-selinux) rather than disabling SELinux; use permissive mode only as a diagnostic step",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-apparmor-blocks-container",
        "title": "AppArmor profile denies container operations",
        "keywords": ["AppArmor", "apparmor denied", "dmesg apparmor", "docker-default", "cri-containerd.apparmor"],
        "root_cause": "The default AppArmor profile or a custom profile can deny mounts, network syscalls, or file operations needed by a workload. Denials appear in dmesg and journalctl.",
        "remediation": [
            {
                "action": "check_denials",
                "description": "Check recent AppArmor denials",
                "command": "sudo dmesg | grep -i apparmor | tail -50; sudo journalctl -k | grep -i apparmor | tail -50",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Adjust the pod's appArmorProfile or craft a custom profile rather than disabling AppArmor globally",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-calico-node-not-ready",
        "title": "calico-node DaemonSet is not Ready on a node",
        "keywords": ["calico-node", "calico CrashLoopBackOff", "Calico is not running", "felix not ready", "bird not ready"],
        "root_cause": "calico-node fails readiness because it cannot reach the API server, cannot autodetect the node IP, or has incompatible IPPool/MTU settings. Pods on that node cannot get networking.",
        "remediation": [
            {
                "action": "read_logs",
                "description": "Read calico-node logs for the specific component that failed",
                "command": "kubectl -n kube-system logs -l k8s-app=calico-node -c calico-node --tail=200 --field-selector spec.nodeName=<node> 2>/dev/null || kubectl -n kube-system logs <calico-node-pod> -c calico-node --tail=200",
                "rollback": None
            },
            {
                "action": "check_typha_felix",
                "description": "Check felix and BIRD readiness",
                "command": "kubectl -n kube-system exec <calico-node-pod> -- calico-node -felix-live; kubectl -n kube-system exec <calico-node-pod> -- calico-node -bird-ready",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-calico-ippool-exhausted",
        "title": "Calico IPPool is exhausted and new pods stay ContainerCreating",
        "keywords": ["calico ippool exhausted", "IPAM block full", "no IP available", "calico-ipam", "FailedCreatePodSandBox calico"],
        "root_cause": "Calico allocates pod IPs from IPPool blocks assigned to each node. If a block is exhausted or IP autodetection is wrong, new pods on that node cannot get an IP.",
        "remediation": [
            {
                "action": "check_ippools",
                "description": "Inspect IPPool allocations and per-node blocks",
                "command": "kubectl get ippools.crd.projectcalico.org -o yaml; kubectl get ipamblocks.crd.projectcalico.org -o wide",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Enlarge the pool or reduce block size; fix IP autodetection if the wrong interface is used",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-calico-ip-autodetection-wrong-interface",
        "title": "Calico autodetects the wrong node IP",
        "keywords": ["calico autodetection", "IP_AUTODETECTION_METHOD", "calico wrong node IP", "calico first-found", "node internal IP mismatch"],
        "root_cause": "Calico's default 'first-found' autodetection may select a secondary interface (management, storage). Peerings and routes then point at the wrong IP and pod traffic fails across nodes.",
        "remediation": [
            {
                "action": "check_node_ip",
                "description": "Show the node IPs and the address Calico uses",
                "command": "kubectl get node <node> -o jsonpath='{.status.addresses}{\"\\n\"}'; kubectl -n kube-system exec <calico-node-pod> -- calico-node -show-node-ip 2>/dev/null || true",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Set IP_AUTODETECTION_METHOD to the correct interface or CIDR via the DaemonSet env",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-calico-mtu-mismatch",
        "title": "Calico MTU mismatch causes TLS hangs over the tunnel",
        "keywords": ["calico MTU", "VXLAN MTU", "IPIP MTU", "packet too long", "calico 1450 1480"],
        "root_cause": "Calico sets the tunnel MTU based on the detected underlying interface. If the physical MTU is lower than assumed (or a second encapsulation is in play), large packets are dropped and TLS handshakes or streaming reads hang.",
        "remediation": [
            {
                "action": "check_mtu",
                "description": "Show node interface MTU and Calico's tunnel MTU",
                "command": "ip -d link show | grep -E 'mtu|vxlan|tunl0'; kubectl -n kube-system exec <calico-node-pod> -- ip -d link show",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Adjust FELIX_MTU or veth_mtu to match the fabric; verify with a large-packet ping",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-cilium-bpf-fs-not-mounted",
        "title": "Cilium agent cannot mount or access the BPF filesystem",
        "keywords": ["cilium bpf", "/sys/fs/bpf", "BPFFS", "cilium agent not ready", "bpf filesystem not mounted"],
        "root_cause": "Cilium requires a mounted BPF filesystem. On minimal hosts or with hardened systemd units, /sys/fs/bpf may not be mounted or may lack the required permissions, so the agent fails to program BPF maps.",
        "remediation": [
            {
                "action": "check_mount",
                "description": "Check BPF filesystem mount",
                "command": "mount | grep bpf; ls -la /sys/fs/bpf",
                "rollback": None
            },
            {
                "action": "mount_bpf_fs",
                "description": "Mount the BPF filesystem and restart the Cilium agent",
                "command": "sudo mount -t bpf bpf /sys/fs/bpf; kubectl -n kube-system rollout restart ds/cilium",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-cilium-agent-not-ready",
        "title": "Cilium agent is not Ready on a node",
        "keywords": ["cilium-agent not ready", "cilium health", "cilium status", "cilium pod crash", "cilium kube-proxy replacement"],
        "root_cause": "The Cilium agent can fail readiness when BPF resources are unavailable, the kernel is too old for required features, kube-proxy replacement conflicts with an existing kube-proxy, or the agent cannot reach the API server.",
        "remediation": [
            {
                "action": "run_cilium_status",
                "description": "Run the cilium status command inside the agent pod",
                "command": "kubectl -n kube-system exec <cilium-pod> -- cilium status --verbose",
                "rollback": None
            },
            {
                "action": "read_logs",
                "description": "Read agent logs for feature or BPF errors",
                "command": "kubectl -n kube-system logs <cilium-pod> --tail=200",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-flannel-vxlan-fdb-missing",
        "title": "Flannel VXLAN FDB entries are missing so cross-node pod traffic fails",
        "keywords": ["flannel.1", "flannel FDB", "bridge fdb", "flannel vxlan", "flannel across nodes"],
        "root_cause": "Flannel programs VXLAN FDB entries per remote node. If the kube-flannel pod is unhealthy or cannot watch the API server, FDB entries are missing and packets to remote pod subnets are dropped.",
        "remediation": [
            {
                "action": "check_fdb",
                "description": "Show FDB entries on flannel.1",
                "command": "bridge fdb show dev flannel.1; ip -d link show flannel.1",
                "rollback": None
            },
            {
                "action": "check_flannel_logs",
                "description": "Read kube-flannel logs on the node",
                "command": "kubectl -n kube-flannel logs <kube-flannel-pod> --tail=200",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-flannel-subnet-exhausted",
        "title": "Flannel node subnet is exhausted",
        "keywords": ["flannel subnet exhausted", "flannel subnet full", "flannel no IP", "pod IP exhaustion flannel"],
        "root_cause": "Flannel assigns one /24 (or configured prefix) per node. If the node runs many pods, the pod CIDR runs out and new pods cannot get IPs.",
        "remediation": [
            {
                "action": "check_subnet",
                "description": "Show the allocated pod subnet for the node",
                "command": "cat /run/flannel/subnet.env 2>/dev/null; kubectl get node <node> -o jsonpath='{.spec.podCIDR}{\"\\n\"}'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Increase per-node prefix size and reinstall flannel, or enable a larger cluster CIDR",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-canal-flannel-calico-mismatch",
        "title": "Canal's Flannel pod subnet and Calico IPPool are inconsistent",
        "keywords": ["canal", "canal flannel calico", "canal subnet mismatch", "canal ippool", "canal pods not ready"],
        "root_cause": "Canal combines Flannel for dataplane and Calico for policy. If the Calico IPPool does not match the Flannel cluster CIDR, packets may be routed with the wrong source subnet and NetworkPolicy is not enforced as expected.",
        "remediation": [
            {
                "action": "check_pool_and_flannel",
                "description": "Compare Flannel cluster CIDR and Calico IPPool",
                "command": "kubectl -n kube-system get cm canal-config -o yaml | grep -A3 -i 'net-conf'; kubectl get ippools.crd.projectcalico.org -o yaml",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Align the Flannel net-conf.json ClusterCIDR with the Calico IPPool, then reinstall Canal",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-kube-proxy-ipvs-no-ipvs-modules",
        "title": "kube-proxy IPVS mode fails because IPVS kernel modules are missing",
        "keywords": ["kube-proxy ipvs", "ip_vs modules missing", "IPVS mode", "kube-proxy ipvs error", "modprobe ip_vs"],
        "root_cause": "IPVS mode requires ip_vs and related scheduler modules (ip_vs_rr, ip_vs_wrr, ip_vs_sh, nf_conntrack). On minimal kernels these are not loaded and kube-proxy falls back or fails.",
        "remediation": [
            {
                "action": "check_modules",
                "description": "Check whether IPVS modules are loaded",
                "command": "lsmod | grep -E 'ip_vs|nf_conntrack'; ipvsadm -Ln 2>/dev/null | head",
                "rollback": None
            },
            {
                "action": "load_modules",
                "description": "Load IPVS modules and persist them",
                "command": "printf 'ip_vs\\nip_vs_rr\\nip_vs_wrr\\nip_vs_sh\\nnf_conntrack\\n' | sudo tee /etc/modules-load.d/ipvs.conf; sudo modprobe ip_vs ip_vs_rr ip_vs_wrr ip_vs_sh nf_conntrack; sudo systemctl restart kube-proxy",
                "rollback": "sudo rm /etc/modules-load.d/ipvs.conf; sudo systemctl restart kube-proxy"
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kube-proxy-mode-mismatch",
        "title": "kube-proxy mode differs between nodes",
        "keywords": ["kube-proxy mode mismatch", "iptables ipvs mixed", "kube-proxy configmap", "service routing inconsistent"],
        "root_cause": "If some nodes run iptables mode and others IPVS mode, Service routing and session affinity behave differently across nodes, producing confusing intermittent failures.",
        "remediation": [
            {
                "action": "check_modes",
                "description": "Show the kube-proxy mode on each node",
                "command": "for p in $(kubectl -n kube-system get pods -l k8s-app=kube-proxy -o name); do echo -n \"$p: \"; kubectl -n kube-system exec $p -- kube-proxy --version >/dev/null 2>&1 && kubectl -n kube-system get $p -o jsonpath='{.spec.containers[0].command}{\"\\n\"}'; done; kubectl -n kube-system get cm kube-proxy -o yaml | grep -i mode",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Standardize kube-proxy mode cluster-wide via the ConfigMap and rolling restart",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubernetes-apiserver-certificate-expired",
        "title": "kube-apiserver certificate has expired",
        "keywords": ["apiserver cert expired", "x509 expired", "kubeadm certs check-expiration", "certificate has expired", "apiserver TLS"],
        "root_cause": "kubeadm-generated certificates default to one year. Without renewal, the API server certificate expires and all clients fail TLS verification cluster-wide.",
        "remediation": [
            {
                "action": "check_expiry",
                "description": "Show cluster certificate expiration",
                "command": "sudo kubeadm certs check-expiration",
                "rollback": None
            },
            {
                "action": "renew",
                "description": "Renew all control-plane certificates and restart the static pods",
                "command": "sudo kubeadm certs renew all; sudo systemctl restart kubelet",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-scheduler-pod-failed-scheduling-taints",
        "title": "Pods stay Pending because of node taints",
        "keywords": ["FailedScheduling", "taints", "0/N nodes are available", "node(s) had taint", "taint NoSchedule"],
        "root_cause": "Control-plane nodes carry NoSchedule taints. Workloads without matching tolerations are rejected. Additional taints (spot, maintenance) can compound this.",
        "remediation": [
            {
                "action": "inspect_events",
                "description": "Read pod scheduling events",
                "command": "kubectl describe pod <pod> -n <ns> | sed -n '/Events/,$p'",
                "rollback": None
            },
            {
                "action": "list_taints",
                "description": "Show node taints",
                "command": "kubectl get nodes -o json | jq -r '.items[] | .metadata.name as $n | (.spec.taints // [])[] | \"\\($n)\\t\\(.key)=\\(.value):\\(.effect)\"'",
                "rollback": None
            }
        ],
        "risk_level": "low"
    },
    {
        "id": "linux-scheduler-insufficient-cpu",
        "title": "Pods cannot schedule due to insufficient CPU/memory on any node",
        "keywords": ["Insufficient cpu", "Insufficient memory", "0/N nodes are available", "FailedScheduling", "requests too large"],
        "root_cause": "The sum of pod resource requests exceeds allocatable capacity on all eligible nodes. This commonly happens on freshly provisioned clusters with small nodes or with overly generous resource requests.",
        "remediation": [
            {
                "action": "check_allocatable",
                "description": "Show allocatable and currently requested resources",
                "command": "kubectl describe node <node> | sed -n '/Allocated resources/,/Events/p'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Adjust requests/limits, add capacity, or remove node taints/labels constraining scheduling",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "low"
    },
    {
        "id": "linux-eviction-disk-pressure",
        "title": "Node reports DiskPressure and evicts pods",
        "keywords": ["DiskPressure", "Evicted", "The node was low on resource: ephemeral-storage", "kubelet eviction", "imagefs"],
        "root_cause": "kubelet evicts pods when the imagefs or root filesystem crosses the eviction threshold. Common triggers are accumulated container images, large logs under /var/log, or a full root filesystem.",
        "remediation": [
            {
                "action": "check_disk",
                "description": "Check root and image filesystem usage and kubelet conditions",
                "command": "df -h / /var/lib/containerd /var/log; kubectl describe node <node> | sed -n '/Conditions/,/Addresses/p'",
                "rollback": None
            },
            {
                "action": "prune_images",
                "description": "Prune unused container images and dead containers",
                "command": "sudo crictl rmi --prune; sudo crictl rm $(sudo crictl ps -a -q --state exited) 2>/dev/null || true",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-eviction-memory-pressure",
        "title": "Node reports MemoryPressure and evicts pods",
        "keywords": ["MemoryPressure", "Evicted memory", "The node was low on resource: memory", "kubelet memory eviction"],
        "root_cause": "kubelet evicts pods when the node crosses the eviction threshold or when the kernel OOM-killer targets containers. Overcommit from BestEffort pods is a frequent contributor.",
        "remediation": [
            {
                "action": "check_memory",
                "description": "Show memory usage and top consumers",
                "command": "free -h; sudo ps -eo pid,comm,rss --sort=-rss | head -20",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Set resource requests/limits, add capacity, or investigate the memory-hungry workload",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-oom-killed-container",
        "title": "Container is OOMKilled by the kernel",
        "keywords": ["OOMKilled", "exit code 137", "out of memory", "kernel oom", "container last state terminated"],
        "root_cause": "The container exceeded its memory limit or the node ran out of memory. The kernel OOM-killer terminated the process, producing exit code 137 and a restart.",
        "remediation": [
            {
                "action": "inspect_pod",
                "description": "Confirm the OOM event and the limit",
                "command": "kubectl get pod <pod> -n <ns> -o jsonpath='{.status.containerStatuses[*].lastState.terminated.reason}{\"\\n\"}'; kubectl get pod <pod> -n <ns> -o jsonpath='{.spec.containers[*].resources}{\"\\n\"}'",
                "rollback": None
            },
            {
                "action": "check_kernel_log",
                "description": "Look for kernel OOM messages on the node",
                "command": "sudo dmesg -T | grep -iE 'out of memory|oom-kill' | tail -30",
                "rollback": None
            }
        ],
        "risk_level": "low"
    },
    {
        "id": "linux-oom-killed-system-oom",
        "title": "Node-level OOM kills kubelet, containerd, or a critical process",
        "keywords": ["node oom", "system oom", "kubelet killed oom", "containerd killed", "critical process oom"],
        "root_cause": "A node-level memory shortage (often a misbehaving workload without limits) can cause the kernel OOM-killer to kill kubelet or containerd, destabilizing all pods on that node.",
        "remediation": [
            {
                "action": "inspect_kernel_log",
                "description": "Show recent OOM kill messages and the victim process",
                "command": "sudo dmesg -T | grep -iE 'oom|killed process' | tail -60",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Identify the unconstrained workload, add requests/limits, or add node capacity",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-pvc-failed-mount-multipath",
        "title": "PVC mount fails with multipath conflicts on SAN-backed storage",
        "keywords": ["FailedMount", "multipath", "device already mounted", "SAN", "iscsi multipath", "dm-multipath"],
        "root_cause": "Without multipath.conf exclusions for non-SAN devices, multipath can claim the same block device twice, producing 'device already mounted' or missing-device errors when CSI/attach tries to format and mount.",
        "remediation": [
            {
                "action": "check_multipath",
                "description": "Show multipath topology and mounts",
                "command": "sudo multipath -ll; lsblk -f; mount | grep -E 'mpath|sd'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Configure /etc/multipath.conf blacklists per storage vendor guidance; never delete devices while pods are mounted",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-nfs-stale-handle",
        "title": "NFS volumes report stale file handle and pods restart",
        "keywords": ["stale file handle", "NFS stale", "Stale NFS handle", "ESTALE", "nfs mount stale"],
        "root_cause": "NFS servers can invalidate file handles when the export is recreated or the server restarts. Clients keep referencing the old handle, producing ESTALE errors that kill pod processes.",
        "remediation": [
            {
                "action": "check_mount",
                "description": "Check current NFS mounts and errors",
                "command": "mount | grep nfs; sudo dmesg | grep -i nfs | tail -40",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Remount the export on a maintenance window; prefer persistent exports and stable server identity",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-local-path-provisioner-disk-full",
        "title": "local-path-provisioner cannot allocate new volumes because the disk is full",
        "keywords": ["local-path-provisioner", "local-path PV", "no space left on device", "volume provisioning failed"],
        "root_cause": "Local path volumes consume the same disk as images and logs. Filling /var/lib/rancher or /opt/local-path-provisioner blocks new PVCs and evicts pods.",
        "remediation": [
            {
                "action": "check_disk",
                "description": "Check disk usage and the provisioner path",
                "command": "df -h /var/lib/rancher /opt/local-path-provisioner 2>/dev/null; sudo du -sh /var/lib/rancher/local-path-provisioner/* 2>/dev/null | sort -h | tail",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Free space by pruning unused PVCs/images and consider moving the provisioner path to a dedicated volume",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-csi-driver-node-not-registered",
        "title": "CSI driver node pod is not registered with kubelet",
        "keywords": ["CSINode", "csi driver not registered", "driver name not found", "CSINode object missing", "csi plugin not running"],
        "root_cause": "Each CSI driver must register a CSINode entry. If the node plugin pod is not running or has a name mismatch, PVCs referencing that driver fail with 'driver name not found'.",
        "remediation": [
            {
                "action": "check_csinode",
                "description": "Show CSINode objects and driver entries",
                "command": "kubectl get csinodes -o wide; kubectl get csinode <node> -o yaml",
                "rollback": None
            },
            {
                "action": "check_driver_pods",
                "description": "Confirm the node driver pod is running on the node",
                "command": "kubectl get pods -A -o wide --field-selector spec.nodeName=<node> | grep -i csi",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-metallb-no-addresses",
        "title": "MetalLB LoadBalancer service stays Pending",
        "keywords": ["metallb", "LoadBalancer pending", "IPAddressPool", "L2Advertisement", "metallb no addresses"],
        "root_cause": "Without a matching IPAddressPool and L2/BGP advertisement, MetalLB cannot assign an external IP. Services remain Pending and no traffic can reach them from outside.",
        "remediation": [
            {
                "action": "check_pools",
                "description": "List MetalLB pools and advertisements",
                "command": "kubectl -n metallb-system get ipaddresspools,l2advertisements,bgpadvertisements; kubectl -n metallb-system get pods",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Create or fix the IPAddressPool and advertisement to cover the requested address range",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-metallb-l2-arp-conflict",
        "title": "MetalLB L2 mode ARP conflict on the same subnet",
        "keywords": ["metallb ARP", "arp conflict", "metallb L2 speaker", "external IP unreachable", "gratuitous arp"],
        "root_cause": "MetalLB L2 mode answers ARP for the service IP on one node. If a static host on the same subnet also claims the IP, or the upstream switch blocks gratuitous ARP, clients intermittently reach the wrong device.",
        "remediation": [
            {
                "action": "check_speaker",
                "description": "Show which node is advertising the service IP",
                "command": "kubectl -n metallb-system logs -l app=metallb,component=speaker --tail=100 | grep -i 'service'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Reserve the MetalLB pool outside any DHCP or static range; verify gratuitous ARP is permitted on the fabric",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-air-gapped-image-pull-fail",
        "title": "Image pull fails on air-gapped clusters because the registry is unreachable",
        "keywords": ["air-gapped", "ErrImagePull", "ImagePullBackOff", "private registry unreachable", "no internet pull"],
        "root_cause": "Air-gapped nodes cannot reach public registries. Without a private mirror and correct image references, every pull fails with 'no such host' or 'connection refused'.",
        "remediation": [
            {
                "action": "confirm_symptom",
                "description": "Inspect the pod event for the failed registry host",
                "command": "kubectl describe pod <pod> -n <ns> | sed -n '/Events/,$p'",
                "rollback": None
            },
            {
                "action": "check_registry",
                "description": "Verify the private registry is reachable from the node",
                "command": "curl -kv https://<registry-host>:<port>/v2/",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Mirror images into the private registry and update image references or configure containerd registry mirrors accordingly",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-private-registry-ca-not-trusted",
        "title": "containerd on Linux does not trust the private registry CA",
        "keywords": ["private registry CA", "containerd certs.d", "x509: certificate signed by unknown authority", "registry TLS", "mirrors"],
        "root_cause": "containerd does not use the system trust store for registry TLS by default. A private CA placed only in /etc/ssl/certs is ignored unless the cert is also installed under /etc/containerd/certs.d/<host>/.",
        "remediation": [
            {
                "action": "install_ca",
                "description": "Install the CA under the per-host certs.d directory",
                "command": "sudo mkdir -p /etc/containerd/certs.d/<registry-host>; sudo cp registry-ca.crt /etc/containerd/certs.d/<registry-host>/ca.crt",
                "rollback": "sudo rm -rf /etc/containerd/certs.d/<registry-host>"
            },
            {
                "action": "restart_containerd",
                "description": "Restart containerd to load the new trust configuration",
                "command": "sudo systemctl restart containerd",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-proxy-noproxy-missing-cluster-cidrs",
        "title": "HTTP proxy on the node intercepts cluster-internal traffic",
        "keywords": ["HTTP_PROXY", "NO_PROXY", "proxy intercepts cluster traffic", "containerd proxy", "kubelet proxy"],
        "root_cause": "When HTTP(S)_PROXY is set but NO_PROXY does not include the pod CIDR, Service CIDR, and control-plane endpoints, kubelet and containerd route internal traffic through the proxy, breaking API and pod communication.",
        "remediation": [
            {
                "action": "check_env",
                "description": "Show proxy environment for systemd and containerd",
                "command": "sudo systemctl show kubelet containerd -p Environment; cat /etc/systemd/system/containerd.service.d/*.conf 2>/dev/null; cat /etc/environment /etc/profile.d/*proxy*.sh 2>/dev/null",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Extend NO_PROXY to include 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.1, localhost, the Service CIDR, and the API server endpoint",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-duplicate-hostname-clone",
        "title": "Cloned Linux VM keeps the original hostname and joins as a duplicate node",
        "keywords": ["duplicate hostname", "clone node name conflict", "same hostname two nodes", "kubelet node already registered"],
        "root_cause": "Cloning a VM copies /etc/hostname and cloud-init identity. The new node registers under the same node name, overwriting the original node object and confusing scheduling and kube-proxy.",
        "remediation": [
            {
                "action": "check_identity",
                "description": "Show hostname and machine identity",
                "command": "hostnamectl status; cat /etc/machine-id; cloud-init query --all 2>/dev/null | head",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Regenerate machine-id, set a unique hostname, and re-run cloud-init clean before joining the cluster",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-duplicate-machine-id-clone",
        "title": "Cloned Linux VM shares the same /etc/machine-id",
        "keywords": ["machine-id duplicate", "/etc/machine-id", "dbus duplicate", "clone machine-id", "systemd machine id"],
        "root_cause": "systemd and several agents use /etc/machine-id as a stable identifier. Duplicated IDs cause conflicts in logging, telemetry, and some CSI or agent code paths.",
        "remediation": [
            {
                "action": "check_machine_id",
                "description": "Show machine-id",
                "command": "cat /etc/machine-id",
                "rollback": None
            },
            {
                "action": "regenerate",
                "description": "Remove and regenerate machine-id on the clone",
                "command": "sudo rm -f /etc/machine-id; sudo systemd-machine-id-setup; sudo reboot",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-stale-ssh-host-key-clone",
        "title": "Cloned Linux VM shares the original SSH host key",
        "keywords": ["SSH host key", "REMOTE HOST IDENTIFICATION HAS CHANGED", "clone ssh key", "ssh-keygen -A"],
        "root_cause": "Cloning a VM copies /etc/ssh/ssh_host_* keys. Automation then fails host-key verification, and multiple nodes present the same key, weakening trust.",
        "remediation": [
            {
                "action": "check_keys",
                "description": "Show SSH host key fingerprints",
                "command": "for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf $f; done",
                "rollback": None
            },
            {
                "action": "regenerate",
                "description": "Regenerate SSH host keys and restart sshd",
                "command": "sudo rm -f /etc/ssh/ssh_host_*; sudo ssh-keygen -A; sudo systemctl restart sshd",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-nic-rename-after-clone",
        "title": "Linux NIC renames after VM clone and breaks CNI",
        "keywords": ["NIC rename", "predictable network names", "ens192 ens224 renamed", "net.ifnames", "cloud-init netplan"],
        "root_cause": "Predictable network names depend on PCI slot and MAC. After cloning with different hardware, the NIC may be renamed (eth0 -> ens192), so static configuration and CNI interface references no longer apply.",
        "remediation": [
            {
                "action": "check_links",
                "description": "Show interfaces and their addresses",
                "command": "ip -br link; ip -br addr",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Update netplan/NetworkManager profiles to match the new interface names or pin names via udev rules",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-cloud-init-stale-network-config",
        "title": "cloud-init applies stale network config after cloning",
        "keywords": ["cloud-init network", "stale netplan", "cloud-init instance-id", "datasource cache", "clone network config"],
        "root_cause": "cloud-init caches its instance data. After cloning or snapshotting, cloud-init may not re-run network configuration, so the clone keeps the old IP, gateway, or DNS.",
        "remediation": [
            {
                "action": "check_status",
                "description": "Show cloud-init status and datasource",
                "command": "cloud-init status --long; sudo cat /var/lib/cloud/data/status.json 2>/dev/null | head",
                "rollback": None
            },
            {
                "action": "clean_and_rerun",
                "description": "Clean cloud-init state and reboot so the network is reconfigured",
                "command": "sudo cloud-init clean --logs --reboot",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-time-drift-ntp",
        "title": "Node clock is out of sync and breaks TLS and etcd",
        "keywords": ["clock skew", "NTP drift", "timedatectl", "chrony not syncing", "x509 not yet valid", "etcd clock skew"],
        "root_cause": "kubelet, apiserver, and etcd rely on accurate time for certificate validation and lease-based leader election. A drifting clock causes x509 'not yet valid' errors or unstable etcd leadership.",
        "remediation": [
            {
                "action": "check_time",
                "description": "Show current time sync state",
                "command": "timedatectl; chronyc tracking 2>/dev/null",
                "rollback": None
            },
            {
                "action": "enable_ntp",
                "description": "Enable systemd-timesyncd or chrony against reachable NTP servers",
                "command": "sudo timedatectl set-ntp true; sudo systemctl restart systemd-timesyncd 2>/dev/null || sudo systemctl restart chronyd 2>/dev/null",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-rke2-server-not-ready",
        "title": "RKE2 server does not become Ready after start",
        "keywords": ["rke2-server", "rke2 not ready", "rke2 startup failed", "systemctl status rke2-server", "rke2 service failed"],
        "root_cause": "rke2-server can fail readiness on a first-boot node because of missing kernel modules (overlay, br_netfilter), firewall rules blocking 9345/6443, or the config file referencing a wrong token or server URL.",
        "remediation": [
            {
                "action": "check_status",
                "description": "Show rke2-server unit and recent logs",
                "command": "sudo systemctl status rke2-server --no-pager; sudo journalctl -u rke2-server --since '10 min ago' | tail -150",
                "rollback": None
            },
            {
                "action": "check_ports_and_modules",
                "description": "Confirm required ports and kernel modules",
                "command": "sudo ss -lntp | grep -E ':(9345|6443)\\b'; lsmod | grep -E 'br_netfilter|overlay'",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-rke2-agent-registration-failed",
        "title": "RKE2 agent fails to register with the server",
        "keywords": ["rke2-agent", "rke2 agent join", "server URL", "token mismatch", "rke2 registration failed", "9345"],
        "root_cause": "rke2-agent requires the correct server URL (https://<server>:9345), the cluster token, and network reachability to 9345. Mismatches produce 'connection refused' or 'invalid token' errors and the agent never joins.",
        "remediation": [
            {
                "action": "check_config",
                "description": "Show the rke2 config used by the agent",
                "command": "sudo cat /etc/rancher/rke2/config.yaml",
                "rollback": None
            },
            {
                "action": "check_connectivity",
                "description": "Test reachability to the server on 9345",
                "command": "nc -vz <server> 9345",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-rke2-6443-vs-9345-port-confusion",
        "title": "RKE2 agent configured against 6443 instead of 9345",
        "keywords": ["rke2 9345", "rke2 6443", "rke2 server URL wrong", "supervisor port", "rke2 agent error"],
        "root_cause": "RKE2 uses 9345 for the supervisor (agent registration) and 6443 for the Kubernetes API. Pointing agents at 6443 produces TLS/supervisor errors because the API server does not implement the supervisor API.",
        "remediation": [
            {
                "action": "check_server_url",
                "description": "Show the configured server URL",
                "command": "sudo grep -i '^server' /etc/rancher/rke2/config.yaml",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Set server: https://<server-ip-or-fqdn>:9345 and restart rke2-agent",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-rke2-embedded-etcd-latency",
        "title": "RKE2 embedded etcd is unstable due to slow storage",
        "keywords": ["rke2 etcd", "embedded etcd slow", "rke2 leader change", "etcd disk latency rke2", "rke2 control plane unstable"],
        "root_cause": "RKE2 runs embedded etcd on the server node. Network-attached or throttled storage causes fsync latency, leader elections, and API timeouts, destabilizing the whole cluster.",
        "remediation": [
            {
                "action": "measure_io",
                "description": "Measure fsync latency on /var/lib/rancher/rke2/server/db",
                "command": "sudo fio --filename=/var/lib/rancher/rke2/server/db/fio.test --size=64m --rw=write --bs=8k --ioengine=libaio --iodepth=1 --direct=1 --name=rke2-etcd-io --runtime=30; sudo rm -f /var/lib/rancher/rke2/server/db/fio.test",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Place the RKE2 datastore on a dedicated local SSD; avoid network storage for control-plane nodes",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-apt-lock-held",
        "title": "apt or unattended-upgrades holds the lock during provisioning",
        "keywords": ["Could not get lock /var/lib/dpkg/lock", "apt lock", "unattended-upgrades running", "dpkg frontend lock"],
        "root_cause": "Unattended-upgrades or a parallel apt process holds /var/lib/dpkg/lock-frontend. Provisioning scripts that install packages fail with 'Could not get lock' and partial installs cause later Kubernetes issues.",
        "remediation": [
            {
                "action": "check_locks",
                "description": "Show processes holding apt/dpkg locks",
                "command": "sudo lsof /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock 2>/dev/null; ps -ef | grep -E 'apt|unattended' | grep -v grep",
                "rollback": None
            },
            {
                "action": "wait_or_stop",
                "description": "Wait for the running process or stop unattended-upgrades before provisioning",
                "command": "sudo systemctl stop unattended-upgrades 2>/dev/null; sudo systemctl disable --now apt-daily.timer apt-daily-upgrade.timer 2>/dev/null",
                "rollback": "sudo systemctl enable --now apt-daily.timer apt-daily-upgrade.timer 2>/dev/null"
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-gpg-key-expired-repo",
        "title": "Repository GPG key is expired and blocks apt/dnf",
        "keywords": ["GPG error", "NO_PUBKEY", "EXPKEYSIG", "repository key expired", "apt update failed"],
        "root_cause": "Kubernetes and container runtime repositories ship signing keys with expiry dates. An expired key blocks `apt update` and `dnf makecache`, stalling installation or upgrade.",
        "remediation": [
            {
                "action": "check_error",
                "description": "Show the exact apt/dnf error",
                "command": "sudo apt update 2>&1 | tail -20 || sudo dnf makecache 2>&1 | tail -20",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Fetch the current signing key from the distribution and re-import it; do not disable signature verification",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-sudo-no-tty-in-automation",
        "title": "sudo requires a TTY and breaks automation",
        "keywords": ["sudo: a terminal is required", "sudo no tty", "requiretty", "sudo automation", "sudo NOPASSWD"],
        "root_cause": "Some distributions enable Defaults requiretty in sudoers. Automation that runs sudo without a pseudo-terminal fails even when the user is a valid sudoer.",
        "remediation": [
            {
                "action": "confirm",
                "description": "Reproduce with a non-interactive command",
                "command": "ssh <user>@<host> 'sudo -n true' 2>&1",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Prefer running automation as root via cloud-init/SSM, or configure NOPASSWD for the specific provisioning user via a drop-in in /etc/sudoers.d",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kernel-modules-not-persistent",
        "title": "Required kernel modules do not survive reboot",
        "keywords": ["modules-load.d", "br_netfilter not loaded after reboot", "overlay not loaded", "kernel modules reboot", "kubelet after reboot"],
        "root_cause": "Modules loaded manually with modprobe are lost after reboot. Without /etc/modules-load.d entries, br_netfilter, overlay, or IPVS modules are missing and kubelet or kube-proxy fail at boot.",
        "remediation": [
            {
                "action": "check_persistence",
                "description": "List persistent module loads and current loads",
                "command": "ls /etc/modules-load.d/; cat /etc/modules-load.d/*.conf 2>/dev/null; lsmod | grep -E 'br_netfilter|overlay|ip_vs'",
                "rollback": None
            },
            {
                "action": "persist",
                "description": "Add required modules to modules-load.d",
                "command": "printf 'overlay\\nbr_netfilter\\n' | sudo tee /etc/modules-load.d/k8s.conf; sudo systemctl restart systemd-modules-load",
                "rollback": "sudo rm /etc/modules-load.d/k8s.conf; sudo systemctl restart systemd-modules-load"
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-fips-rhel-crypto-restrictions",
        "title": "RHEL FIPS mode blocks weakly-hashed certificates or images",
        "keywords": ["FIPS", "RHEL crypto policy", "md5 certificate rejected", "FIPS mode kubernetes", "update-crypto-policies"],
        "root_cause": "FIPS-enforcing hosts reject MD5 or SHA1 signatures. Legacy images, certs, or TLS endpoints relying on those algorithms fail TLS handshakes cluster-wide even though the same setup works on non-FIPS nodes.",
        "remediation": [
            {
                "action": "confirm_fips",
                "description": "Confirm FIPS and crypto policy",
                "command": "fips-mode-setup --check; update-crypto-policies --show",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Replace weak certificates and images rather than relaxing the crypto policy; coordinate with security owners",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-container-image-accumulation",
        "title": "Node accumulates container images until the disk fills",
        "keywords": ["image accumulation", "containerd content full", "crictl rmi", "disk full container images", "imagefs full"],
        "root_cause": "Frequent deployments produce many image tags. When image GC thresholds are too permissive or imagefs is misreported, images accumulate until the disk is full.",
        "remediation": [
            {
                "action": "measure",
                "description": "Measure image store usage",
                "command": "sudo crictl images | head; sudo du -sh /var/lib/containerd/io.containerd.content.v1.content 2>/dev/null; df -h /var/lib/containerd",
                "rollback": None
            },
            {
                "action": "prune",
                "description": "Prune unused images",
                "command": "sudo crictl rmi --prune",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-inode-exhaustion",
        "title": "Filesystem runs out of inodes and pods cannot start",
        "keywords": ["No space left on device inodes", "inode exhaustion", "df -i full", "cannot create file", "kubelet inode"],
        "root_cause": "Some workloads create many small files. When inodes are exhausted, even with free blocks, new file creation fails and kubelet or containers cannot start.",
        "remediation": [
            {
                "action": "check_inodes",
                "description": "Show inode usage",
                "command": "df -i / /var/lib/containerd /var/lib/kubelet",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Identify the directory consuming inodes and clean it (typically log or content stores); never rm -rf paths the runtime is actively writing without a maintenance window",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-file-descriptor-exhaustion",
        "title": "Node hits file descriptor limits and kubelet or containerd errors",
        "keywords": ["too many open files", "fs.file-max", "LimitNOFILE", "kubelet too many open files", "containerd open files"],
        "root_cause": "Default ulimits are too low for busy nodes. kubelet, containerd, and CNI agents open many sockets and files; when the limit is reached, operations fail with 'too many open files'.",
        "remediation": [
            {
                "action": "check_limits",
                "description": "Show current limits and used descriptors",
                "command": "cat /proc/sys/fs/file-max; sudo cat /proc/$(pgrep -x kubelet | head -n1)/limits | grep -i 'open files'; sudo lsof | wc -l",
                "rollback": None
            },
            {
                "action": "raise_limits",
                "description": "Raise LimitNOFILE for kubelet and containerd via systemd drop-ins and reload",
                "command": "sudo mkdir -p /etc/systemd/system/kubelet.service.d /etc/systemd/system/containerd.service.d; printf '[Service]\\nLimitNOFILE=1048576\\n' | sudo tee /etc/systemd/system/kubelet.service.d/limits.conf >/dev/null; printf '[Service]\\nLimitNOFILE=1048576\\n' | sudo tee /etc/systemd/system/containerd.service.d/limits.conf >/dev/null; sudo systemctl daemon-reload; sudo systemctl restart containerd kubelet",
                "rollback": "sudo rm -f /etc/systemd/system/kubelet.service.d/limits.conf /etc/systemd/system/containerd.service.d/limits.conf; sudo systemctl daemon-reload; sudo systemctl restart containerd kubelet"
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-pid-exhaustion",
        "title": "Node reaches its PID limit and cannot fork new processes",
        "keywords": ["fork: Cannot allocate memory", "pid.max", "pids cgroup", "cannot fork", "pid exhaustion"],
        "root_cause": "A cgroup PID limit or the kernel PID limit is reached by runaway workloads, preventing kubelet, systemd, and CNI helpers from forking new processes.",
        "remediation": [
            {
                "action": "check_pids",
                "description": "Show current PID usage and limits",
                "command": "cat /proc/sys/kernel/pid_max; ps -eLf | wc -l; sudo cat /sys/fs/cgroup/pids.current /sys/fs/cgroup/pids.max 2>/dev/null",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Identify the runaway workload and add pids limits or restart it; avoid raising node-wide pid limits as the first response",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-etcd-certificate-expired",
        "title": "etcd peer or server certificate has expired",
        "keywords": ["etcd certificate expired", "x509 expired etcd", "etcd peer cert", "kubeadm etcd certs renew"],
        "root_cause": "etcd uses separate peer and server certificates. If they expire, etcd members cannot communicate and the control plane loses quorum.",
        "remediation": [
            {
                "action": "check_expiry",
                "description": "Show etcd certificate dates",
                "command": "sudo openssl x509 -in /etc/kubernetes/pki/etcd/server.crt -noout -dates; sudo openssl x509 -in /etc/kubernetes/pki/etcd/peer.crt -noout -dates",
                "rollback": None
            },
            {
                "action": "renew",
                "description": "Renew etcd certificates with kubeadm and restart kubelet",
                "command": "sudo kubeadm certs renew etcd-server etcd-peer etcd-healthcheck-client apiserver-etcd-client; sudo systemctl restart kubelet",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-kube-proxy-nodeport-loopback",
        "title": "NodePort is unreachable from the node itself",
        "keywords": ["NodePort localhost", "nodeport not accessible from node", "kube-proxy nodeport loop", "host firewall nodeport"],
        "root_cause": "Some configurations block NodePort access from the node's own IP due to routing or firewall rules, even though the service works from other hosts. This often confuses verification scripts.",
        "remediation": [
            {
                "action": "test_matrix",
                "description": "Test NodePort from the node, from another node, and from outside",
                "command": "for h in 127.0.0.1 <node-ip> <other-node-ip> <external-ip>; do echo -n \"$h: \"; timeout 3 curl -s -o /dev/null -w '%{http_code}\\n' http://$h:<nodeport> || echo fail; done",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Adjust route_localnet, hairpin, or firewall rules as appropriate for the CNI; do not blanket-disable firewalls",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubelet-cgroup-parent-missing",
        "title": "kubelet fails because the configured cgroup parent does not exist",
        "keywords": ["cgroup parent", "kubepods.slice missing", "cgroupDriver systemd", "kubelet failed to create cgroup"],
        "root_cause": "The cgroupParent in KubeletConfiguration must exist for the runtime. A typo or a change between systemd and cgroupfs drivers produces 'failed to create cgroup' errors and pods fail to start.",
        "remediation": [
            {
                "action": "check_config",
                "description": "Show cgroupParent and driver",
                "command": "sudo grep -E 'cgroupParent|cgroupDriver' /var/lib/kubelet/config.yaml",
                "rollback": None
            },
            {
                "action": "inspect_hierarchy",
                "description": "List the current cgroup hierarchy",
                "command": "sudo systemd-cgls /kubepods.slice 2>/dev/null | head -20; ls /sys/fs/cgroup/ | head",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubelet-failed-mount-configmap",
        "title": "Pod fails to mount a ConfigMap or Secret",
        "keywords": ["FailedMount configmap", "FailedMount secret", "mountvolume.SetUp failed", "configmap not found", "secret not found"],
        "root_cause": "kubelet mounts ConfigMaps and Secrets via the API server. Missing objects, wrong namespace, or an unreachable API server produce FailedMount events and pods stay ContainerCreating.",
        "remediation": [
            {
                "action": "read_events",
                "description": "Read the FailedMount event text for the exact cause",
                "command": "kubectl describe pod <pod> -n <ns> | sed -n '/Events/,$p'",
                "rollback": None
            },
            {
                "action": "verify_objects",
                "description": "Confirm ConfigMap/Secret exist in the pod namespace",
                "command": "kubectl get cm,secret -n <ns>",
                "rollback": None
            }
        ],
        "risk_level": "low"
    },
    {
        "id": "linux-kubelet-failed-attach-volume",
        "title": "Pod fails to attach a CSI/PV volume",
        "keywords": ["FailedAttachVolume", "Multi-Attach error", "attachdetach", "volume already attached", "AttachVolume.Attach failed"],
        "root_cause": "Attach/Detach controller or the CSI driver cannot attach the volume. Multi-attach errors typically mean the volume is still attached to another node because a previous pod was not cleanly terminated.",
        "remediation": [
            {
                "action": "read_events",
                "description": "Read the FailedAttachVolume event",
                "command": "kubectl describe pod <pod> -n <ns> | sed -n '/Events/,$p'; kubectl get volumeattachments",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Ensure the old pod is fully deleted and the volume is detached before forcing a new attach; use the CSI driver's documented recovery",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-kubelet-terminating-pod-stuck",
        "title": "Pod stuck in Terminating",
        "keywords": ["Terminating stuck", "pod stuck terminating", "finalizers", "graceful deletion", "kubectl delete --force"],
        "root_cause": "Pods stuck in Terminating are usually blocked by a finalizer, an unreachable node, or a pod that ignores SIGTERM. kubelet cannot complete deletion until the underlying condition is resolved.",
        "remediation": [
            {
                "action": "inspect",
                "description": "Inspect finalizers, deletion timestamp, and node state",
                "command": "kubectl get pod <pod> -n <ns> -o jsonpath='{.metadata.deletionTimestamp} {.metadata.finalizers}{\"\\n\"}'; kubectl get node <node>",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Fix the finalizer owner, restore the node, or use --grace-period=0 --force only when you understand the consequences",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-rbac-forbidden-kubelet",
        "title": "kubelet or an agent receives RBAC Forbidden errors",
        "keywords": ["forbidden", "User \"system:node:...\" cannot", "RBAC kubelet", "cannot get nodes", "kubelet forbidden"],
        "root_cause": "When Node authorizer or the system:node ClusterRole binding is broken (custom CSR approver changes, manual certificate rotation), kubelet loses permissions and can no longer report status or list pods.",
        "remediation": [
            {
                "action": "inspect",
                "description": "Reproduce the forbidden action and identify the user",
                "command": "kubectl auth can-i get nodes --as=system:node:<node>; kubectl get clusterrolebinding system:node -o yaml",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Restore the Node authorizer / system:node binding; do not grant broad ClusterRoles to the node user",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-ssh-known-hosts-automation",
        "title": "SSH known_hosts entries break cluster automation",
        "keywords": ["known_hosts", "StrictHostKeyChecking", "REMOTE HOST IDENTIFICATION", "ssh automation failed", "host key verification"],
        "root_cause": "Automation that reuses VM IPs fails host key verification after node replacement. Operators often respond by disabling StrictHostKeyChecking globally, weakening security.",
        "remediation": [
            {
                "action": "inspect",
                "description": "Show the offending known_hosts entry",
                "command": "ssh-keygen -F <host>",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Update known_hosts with the new key rather than disabling host key verification",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "low"
    },
    {
        "id": "linux-disconnected-kubelet-cache-pressure",
        "title": "kubelet loses the API server for a long time and applies stale state",
        "keywords": ["kubelet disconnected", "node lease expired", "stale pod state", "kubelet stopped posting status"],
        "root_cause": "During extended control-plane outages, kubelet keeps running existing pods with cached configuration. When the API server returns, the state may not match what the cluster believes, producing surprising evictions or rescheduled pods.",
        "remediation": [
            {
                "action": "check_lease",
                "description": "Check node lease freshness after recovery",
                "command": "kubectl get node <node> -o jsonpath='{.status.conditions[?(@.type==\"Ready\")].lastHeartbeatTime}{\"\\n\"}'; kubectl get lease -n kube-node-lease <node> -o yaml | grep -A2 renewTime",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Reconcile workloads after recovery; avoid forced deletion of pods on nodes that may still be running them",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-hugepages-not-configured",
        "title": "Pod requests hugepages that are not configured on the node",
        "keywords": ["hugepages", "hugepages-2Mi", "hugepages not configured", "pod failed hugepages", "hugepages-1Gi"],
        "root_cause": "Pods with hugepages requests need pre-allocated hugepages on the node. Without kernel hugepages configured and kubelet feature registration, the pod stays Pending with a hugepages message.",
        "remediation": [
            {
                "action": "check_hugepages",
                "description": "Show current hugepage allocation",
                "command": "grep -i huge /proc/meminfo; cat /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages 2>/dev/null",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Configure hugepages at boot via kernel parameters and align kubelet with the reserved capacity",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-swap-limit-cgroupv2",
        "title": "Pod hits memory.swap.max when NodeSwap is enabled",
        "keywords": ["NodeSwap", "memory.swap.max", "swap in pod", "cgroup v2 swap limit", "LimitedSwap"],
        "root_cause": "With NodeSwap enabled and LimitedSwap, pods may swap beyond the intended limits, causing latency spikes or OOM under pressure. The swap behavior depends on cgroup v2 and the workload's swap settings.",
        "remediation": [
            {
                "action": "check_swap_usage",
                "description": "Inspect per-pod swap usage and limits",
                "command": "kubectl exec <pod> -- cat /sys/fs/cgroup/memory.swap.current /sys/fs/cgroup/memory.swap.max 2>/dev/null",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Decide deliberately between LimitedSwap and UnlimitedSwap, and set explicit limits; do not enable swap on etcd nodes",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubelet-container-log-growth",
        "title": "Container logs fill /var/log and trigger eviction",
        "keywords": ["container log growth", "kubelet logs dir full", "/var/log/pods full", "containerLogMaxSize", "log rotation"],
        "root_cause": "kubelet writes container stdout/stderr to /var/log/pods and /var/log/containers. Chatty workloads with default rotation settings can fill the filesystem and trigger DiskPressure.",
        "remediation": [
            {
                "action": "check_size",
                "description": "Measure log directory usage",
                "command": "sudo du -sh /var/log/pods /var/log/containers 2>/dev/null; df -h /var/log",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Set containerLogMaxSize and containerLogMaxFiles in KubeletConfiguration to bound log growth",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-iscsi-initiator-login-stale",
        "title": "iSCSI initiator has stale sessions and volumes do not attach",
        "keywords": ["iscsiadm", "stale iscsi session", "device not found iscsi", "multipath iscsi", "attach volume iscsi"],
        "root_cause": "After a node reboot or storage controller failover, stale iSCSI sessions may persist. New sessions log in but the block device nodes do not appear, so attach operations fail.",
        "remediation": [
            {
                "action": "inspect",
                "description": "Show iSCSI sessions and login state",
                "command": "sudo iscsiadm -m session -P 3 2>/dev/null | head -50; lsblk",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Log out stale sessions only when no pods are using the device; coordinate with storage team before removing sessions",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-cloud-metadata-imds-blocked",
        "title": "Node cannot reach cloud metadata service and CSI/CCM fail",
        "keywords": ["IMDS", "169.254.169.254", "metadata service blocked", "cloud provider ID missing", "CSI cannot get instance ID"],
        "root_cause": "Cloud controllers and CSI drivers query the instance metadata service (IMDS) to learn node identity, region, and zone. Firewall rules or IMDSv2 enforcement mismatches block these lookups and break volume attach and load balancing.",
        "remediation": [
            {
                "action": "test_imds",
                "description": "Test IMDS reachability from the node",
                "command": "curl -s -m 3 http://169.254.169.254/latest/meta-data/instance-id || curl -s -m 3 -H 'Metadata: true' 'http://169.254.169.254/metadata/instance?api-version=2021-02-01'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Allow IMDS in firewall rules or ensure IMDSv2 tokens are used; do not expose IMDS to pods",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-multipath-conf-blacklist-missing",
        "title": "multipath.conf does not blacklist root and boot devices",
        "keywords": ["multipath blacklist", "root device multipath", "multipath conflicts root", "kernel panic multipath", "multipath.conf"],
        "root_cause": "Without proper blacklist rules, multipath can claim the root or boot LUN, causing the root filesystem to disappear after a reboot or a cluster install.",
        "remediation": [
            {
                "action": "inspect",
                "description": "Show multipath topology and blacklist",
                "command": "sudo multipath -ll; grep -iE 'blacklist|wwid' /etc/multipath.conf 2>/dev/null",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Add blacklist_exceptions and blacklist entries per the storage vendor's guidance before rebooting the node",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-kubeadm-reset-partial-state",
        "title": "kubeadm reset leaves partial state that breaks reinstall",
        "keywords": ["kubeadm reset", "leftover CNI state", "iptables leftovers", "kubeadm reinstall failed", "cni conflist leftover"],
        "root_cause": "kubeadm reset does not remove CNI configuration, iptables rules, or some /etc/kubernetes files by default. Reinstalling on top of leftover state produces port conflicts, stale rules, and NetworkPluginNotReady.",
        "remediation": [
            {
                "action": "cleanup",
                "description": "Clean leftover state after kubeadm reset on a disposable node",
                "command": "sudo kubeadm reset -f; sudo rm -rf /etc/cni/net.d /var/lib/cni /var/lib/kubelet /etc/kubernetes; sudo iptables -F; sudo iptables -t nat -F; sudo ipvsadm -C 2>/dev/null",
                "rollback": None
            },
            {
                "action": "reboot",
                "description": "Reboot the node to ensure no stale runtime or CNI state remains",
                "command": "sudo reboot",
                "rollback": None
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-loadbalancer-missing-ingress",
        "title": "Ingress controller Service has no external IP",
        "keywords": ["ingress pending", "ingress controller service", "LoadBalancer ingress pending", "external IP missing"],
        "root_cause": "Ingress controllers typically expose a Service of type LoadBalancer. Without a cloud controller or MetalLB, the Service stays Pending and ingress traffic cannot reach the controller.",
        "remediation": [
            {
                "action": "inspect",
                "description": "Show ingress controller Service and events",
                "command": "kubectl get svc -A | grep -iE 'ingress|LoadBalancer'; kubectl describe svc <svc> -n <ns> | tail -30",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Install a matching load balancer implementation or use NodePort/hostNetwork as appropriate",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubelet-runtime-endpoint-wrong",
        "title": "kubelet is configured with the wrong runtime endpoint",
        "keywords": ["containerRuntimeEndpoint", "cri-dockerd sock", "containerd sock wrong", "kubelet runtime endpoint", "runtime not ready"],
        "root_cause": "kubelet must point to the CRI socket exposed by the running runtime. After switching from Docker to containerd (or to cri-dockerd), a leftover endpoint causes 'runtime not ready' and prevents pods from starting.",
        "remediation": [
            {
                "action": "check_config",
                "description": "Show kubelet runtime endpoint and available sockets",
                "command": "sudo grep -i containerRuntimeEndpoint /var/lib/kubelet/config.yaml /etc/kubernetes/kubelet.conf 2>/dev/null; ls -la /run/containerd/containerd.sock /var/run/cri-dockerd.sock /var/run/dockershim.sock 2>/dev/null",
                "rollback": None
            },
            {
                "action": "fix_endpoint",
                "description": "Point kubelet at the correct socket and restart",
                "command": "sudo sed -i 's#containerRuntimeEndpoint:.*#containerRuntimeEndpoint: unix:///run/containerd/containerd.sock#' /var/lib/kubelet/config.yaml; sudo systemctl restart kubelet",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubelet-swap-on-etcd-node",
        "title": "Swap is active on a control-plane or etcd node",
        "keywords": ["swap on etcd", "swap control plane", "etcd latency swap", "swap kubeadm"],
        "root_cause": "Even if kubelet is configured to tolerate swap, swap on a control-plane or etcd node introduces unpredictable latency for etcd fsync and control-plane operations, leading to instability.",
        "remediation": [
            {
                "action": "check_swap",
                "description": "Show swap on all control-plane nodes",
                "command": "swapon --show",
                "rollback": None
            },
            {
                "action": "disable_swap",
                "description": "Disable swap on control-plane and etcd nodes",
                "command": "sudo swapoff -a; sudo sed -i.bak -E '/\\sswap\\s/s/^/#/' /etc/fstab",
                "rollback": "sudo cp /etc/fstab.bak /etc/fstab; sudo swapon -a"
            }
        ],
        "risk_level": "high"
    },
    {
        "id": "linux-kubelet-systemd-unit-overridden",
        "title": "kubelet systemd unit was overridden with wrong flags",
        "keywords": ["kubelet drop-in", "systemctl edit kubelet", "kubelet flags", "kubelet override", "systemd override kubelet"],
        "root_cause": "Provisioning scripts or operators sometimes add drop-ins that replace ExecStart with flags incompatible with the installed kubelet version or the cluster's config layout, causing startup failures.",
        "remediation": [
            {
                "action": "inspect_drop_ins",
                "description": "Show drop-ins and effective ExecStart",
                "command": "sudo systemctl cat kubelet",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Remove or correct the drop-in so it matches the documented kubelet flags for the Kubernetes version",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-hostname-not-fqdn",
        "title": "Node hostname is not resolvable and API registration fails",
        "keywords": ["hostname not resolvable", "FQDN", "node name DNS", "kubelet hostname override", "Unable to register node"],
        "root_cause": "Some CNIs and API server flows expect the node name to be resolvable. A short hostname without a DNS record can prevent API server registration or kubelet-to-API-server TLS SAN matching.",
        "remediation": [
            {
                "action": "check_hostname",
                "description": "Show hostname and resolution",
                "command": "hostname; hostname -f; getent hosts $(hostname)",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Set --hostname-override on kubelet, or add a proper DNS entry for the node",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kube-proxy-configmap-mismatch",
        "title": "kube-proxy ConfigMap changes are not applied after edit",
        "keywords": ["kube-proxy configmap", "kube-proxy restart", "kube-proxy configmap not applied", "kube-proxy rollout restart"],
        "root_cause": "Editing the kube-proxy ConfigMap alone does not restart the DaemonSet. Nodes continue using the old configuration until the pod restarts, giving the impression the change was ineffective.",
        "remediation": [
            {
                "action": "check_config",
                "description": "Show the effective kube-proxy configuration",
                "command": "kubectl -n kube-system get cm kube-proxy -o yaml | grep -A30 'config.conf'",
                "rollback": None
            },
            {
                "action": "restart_daemonset",
                "description": "Roll kube-proxy to pick up the ConfigMap",
                "command": "kubectl -n kube-system rollout restart ds/kube-proxy",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubelet-csr-not-approved",
        "title": "kubelet CSR stays Pending and TLS bootstrap does not finish",
        "keywords": ["csr pending", "kubelet-csr", "certificate signing request not approved", "TLS bootstrap", "kubelet serving csr"],
        "root_cause": "kubelet submits a CSR during TLS bootstrap. Without an approver (disabled approver, RBAC issue), the CSR stays Pending and kubelet cannot complete registration.",
        "remediation": [
            {
                "action": "inspect_csrs",
                "description": "List pending CSRs",
                "command": "kubectl get csr | grep -i pending",
                "rollback": None
            },
            {
                "action": "approve",
                "description": "Approve the CSR after verifying the requesting node identity",
                "command": "kubectl certificate approve <csr-name>",
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-rke2-canal-mtu-vs-mtu-1400",
        "title": "RKE2 Canal MTU is lower than required by workloads",
        "keywords": ["rke2 canal mtu", "rke2 mtu", "canal mtu 1400", "packet too long rke2", "vxlan mtu rke2"],
        "root_cause": "RKE2 defaults Canal MTU based on underlying interface. On clouds with 1450 MTU or additional tunnels, the default may be too high, causing large packets to be dropped and TLS handshakes to fail intermittently.",
        "remediation": [
            {
                "action": "inspect_mtu",
                "description": "Compare node interface MTU to flannel.1 MTU",
                "command": "ip -d link show flannel.1 2>/dev/null; ip -d link show | grep -E 'mtu'",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Adjust the RKE2 config MTU value and restart rke2-server/agent on all nodes",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "medium"
    },
    {
        "id": "linux-kubelet-swap-off-with-cgroupfs",
        "title": "Node has swap off but cgroup v1 memory.swap still shows usage",
        "keywords": ["swap accounting", "memory.swap", "cgroup v1 swap", "swap accounting disabled"],
        "root_cause": "cgroup v1 reports swap usage differently and requires kernel swap accounting for accurate reporting. Disabling swap at runtime does not always clear accounting, misleading diagnostics about real memory pressure.",
        "remediation": [
            {
                "action": "check",
                "description": "Confirm swap state and cgroup version",
                "command": "swapon --show; stat -fc %T /sys/fs/cgroup/; kubectl get --raw /api/v1/nodes/<node>/proxy/stats/summary | head",
                "rollback": None
            },
            {
                "action": "manual_review",
                "description": "Prefer cgroup v2 or enable swap accounting explicitly when accurate numbers matter",
                "command": None,
                "rollback": None
            }
        ],
        "risk_level": "low"
    }
]