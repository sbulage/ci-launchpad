"""CI Launchpad — workflow definitions and constants."""

PORT = 8484
DEFAULT_REPO = "rancher/fleet-e2e"
DEFAULT_COOLDOWN = 30
MIN_COOLDOWN = 10
MAX_COOLDOWN = 300

RUNNER_TEMPLATES = [
    {"value": "fleet-e2e-ci-runner-spot-x86-64-template-v3", "label": "Spot (x86-64)"},
    # must match the workflows' runner_template choice options exactly
    {"value": "fleet-e2e-ci-runner-spot-x86-64-template-v3-dedicated", "label": "Dedicated (x86-64)"},
]

# Kubernetes distros offered in cluster-version dropdowns (distro -> GitHub releases repo)
CLUSTER_DISTROS = {
    "k3s": "k3s-io/k3s",
    "rke2": "rancher/rke2",
}

TAGS_215_PLUS  = ["@login", "@p0", "@p1", "@p1_2", "@rbac", "@special_tests", "@cloud_ds", "@appco"]
TAGS_PRE_215   = ["@login", "@p0", "@p1", "@p1_2", "@rbac", "@special_tests", "@cloud_ds"]
UPGRADE_TAGS   = ["@login", "@upgrade"]
HARDENING_TAGS = ["@login", "@hardening-tests"]

_SPOT = RUNNER_TEMPLATES[0]["value"]
_QASE = {"qase_report": True, "qase_run_id": "", "qase_complete_run": True}

KNOWN_WORKFLOWS = {
    "rancher/fleet-e2e": [
        {
            "file": "ui-rm_head.yaml", "label": "2.16 (head)",
            "rancher_version": "head/2.16", "k3s_version": "v1.37.1+k3s1",
            "tags": "@login @p0 @p1 @p1_2 @rbac @special_tests",
            "available_tags": TAGS_215_PLUS, "runner_template": _SPOT,
            **_QASE, "extras": {},
        },
        {
            "file": "ui-rm_head_2.15.yaml", "label": "2.15 (head)",
            "rancher_version": "head/2.15", "k3s_version": "v1.36.1+k3s1",
            "tags": "@login @p0 @p1 @p1_2 @rbac @special_tests",
            "available_tags": TAGS_215_PLUS, "runner_template": _SPOT,
            **_QASE, "extras": {},
        },
        {
            "file": "ui-rm_head_2.14.yaml", "label": "2.14 (head)",
            "rancher_version": "head/2.14", "k3s_version": "v1.35.2+k3s1",
            "tags": "@login @p0 @p1 @p1_2 @rbac @special_tests",
            "available_tags": TAGS_PRE_215, "runner_template": _SPOT,
            **_QASE, "extras": {},
        },
        {
            "file": "ui-rm_head_2.13.yaml", "label": "2.13 (head)",
            "rancher_version": "head/2.13", "k3s_version": "v1.34.3+k3s1",
            "tags": "@login @p0 @p1 @p1_2 @rbac @special_tests",
            "available_tags": TAGS_PRE_215, "runner_template": _SPOT,
            **_QASE, "extras": {},
        },
        {
            "file": "ui-rm_head_2.12.yaml", "label": "2.12 (head)",
            "rancher_version": "head/2.12", "k3s_version": "v1.33.7+k3s1",
            "tags": "@login @p0 @p1 @p1_2 @rbac @special_tests",
            "available_tags": TAGS_PRE_215, "runner_template": _SPOT,
            **_QASE, "extras": {},
        },
        {
            "file": "ui-rm_head_2.11.yaml", "label": "2.11 (head)",
            "rancher_version": "head/2.11", "k3s_version": "v1.32.10+k3s1",
            "tags": "@login @p0 @p1 @p1_2 @rbac @special_tests",
            "available_tags": TAGS_PRE_215, "runner_template": _SPOT,
            **_QASE, "extras": {},
        },
        {
            "file": "ui-rm_head_upgrade.yaml", "label": "Upgrade",
            "rancher_version": "latest/devel/2.10", "k3s_version": "v1.28.8+k3s1",
            "tags": "@login @upgrade",
            "available_tags": UPGRADE_TAGS, "runner_template": _SPOT,
            **_QASE, "extras": {"rancher_upgrade": "latest/devel/head"},
        },
        {
            "file": "ui-rm-hardening.yaml", "label": "Hardening (RKE2)",
            "rancher_version": "head/2.12", "k3s_version": "v1.32.4+k3s1",
            "tags": "@login @hardening-tests",
            "available_tags": HARDENING_TAGS, "runner_template": _SPOT,
            # choice input: provision-rke2-hardened.sh only has checksums for these
            "rke2_field": "hardening_cluster_version", "rke2_version": "v1.33.0+rke2r1",
            "rke2_choices": ["v1.33.0+rke2r1", "v1.32.8+rke2r1"],
            **_QASE, "extras": {"hardening": "true"},
        },
        {
            "file": "ui-rm_prime_alpha_rc.yaml", "label": "Prime / Alpha / RC",
            "rancher_version": "prime/2.9.1", "k3s_version": "v1.30.8+k3s1",
            "tags": "@login @p0 @p1 @p1_2 @rbac @special_tests",
            "available_tags": TAGS_PRE_215, "runner_template": _SPOT,
            **_QASE, "extras": {},
        },
    ],
}
