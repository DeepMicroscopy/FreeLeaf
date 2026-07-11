import type { components } from "@freeleaf/shared";
import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import styles from "./SsoProviderForm.module.css";

type SsoProviderAdminOut = components["schemas"]["SsoProviderAdminOut"];

export interface SsoProviderFormValues {
  name: string;
  slug: string;
  kind: "saml" | "ldap";
  enabled: boolean;
  saml_idp_entity_id: string;
  saml_idp_sso_url: string;
  saml_idp_x509_cert: string;
  saml_email_attribute: string;
  saml_display_name_attribute: string;
  ldap_server_uri: string;
  ldap_bind_dn: string;
  ldap_bind_password: string;
  ldap_user_search_base: string;
  ldap_user_search_filter: string;
  ldap_email_attribute: string;
  ldap_display_name_attribute: string;
  ldap_use_starttls: boolean;
}

export function SsoProviderForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  initial: SsoProviderAdminOut | null;
  onSubmit: (values: SsoProviderFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [kind, setKind] = useState<"saml" | "ldap">((initial?.kind as "saml" | "ldap") ?? "saml");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  const [samlEntityId, setSamlEntityId] = useState(initial?.saml_idp_entity_id ?? "");
  const [samlSsoUrl, setSamlSsoUrl] = useState(initial?.saml_idp_sso_url ?? "");
  const [samlCert, setSamlCert] = useState(initial?.saml_idp_x509_cert ?? "");
  const [samlEmailAttr, setSamlEmailAttr] = useState(initial?.saml_email_attribute ?? "email");
  const [samlNameAttr, setSamlNameAttr] = useState(initial?.saml_display_name_attribute ?? "displayName");

  const [ldapUri, setLdapUri] = useState(initial?.ldap_server_uri ?? "");
  const [ldapBindDn, setLdapBindDn] = useState(initial?.ldap_bind_dn ?? "");
  const [ldapBindPassword, setLdapBindPassword] = useState("");
  const [ldapSearchBase, setLdapSearchBase] = useState(initial?.ldap_user_search_base ?? "");
  const [ldapSearchFilter, setLdapSearchFilter] = useState(initial?.ldap_user_search_filter ?? "(uid=%(user)s)");
  const [ldapEmailAttr, setLdapEmailAttr] = useState(initial?.ldap_email_attribute ?? "mail");
  const [ldapNameAttr, setLdapNameAttr] = useState(initial?.ldap_display_name_attribute ?? "displayName");
  const [ldapStartTls, setLdapStartTls] = useState(initial?.ldap_use_starttls ?? false);

  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required.");
    if (!initial && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      return setError("Slug must be lowercase letters, digits, and hyphens only.");
    }
    setError(null);
    onSubmit({
      name: name.trim(),
      slug,
      kind,
      enabled,
      saml_idp_entity_id: samlEntityId.trim(),
      saml_idp_sso_url: samlSsoUrl.trim(),
      saml_idp_x509_cert: samlCert.trim(),
      saml_email_attribute: samlEmailAttr.trim(),
      saml_display_name_attribute: samlNameAttr.trim(),
      ldap_server_uri: ldapUri.trim(),
      ldap_bind_dn: ldapBindDn.trim(),
      ldap_bind_password: ldapBindPassword,
      ldap_user_search_base: ldapSearchBase.trim(),
      ldap_user_search_filter: ldapSearchFilter.trim(),
      ldap_email_attribute: ldapEmailAttr.trim(),
      ldap_display_name_attribute: ldapNameAttr.trim(),
      ldap_use_starttls: ldapStartTls,
    });
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.row}>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Technical University of Munich" />
        <TextField
          label="Slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="e.g. tum"
          disabled={!!initial}
          hint={initial ? "Slugs can't be changed after creation." : "Used in login URLs — lowercase, hyphens only."}
        />
      </div>

      <div className={styles.row}>
        <label className={styles.selectField}>
          <span className={styles.label}>Kind</span>
          <select
            className={styles.select}
            value={kind}
            onChange={(e) => setKind(e.target.value as "saml" | "ldap")}
            disabled={!!initial}
          >
            <option value="saml">SAML (Shibboleth)</option>
            <option value="ldap">LDAP / Active Directory</option>
          </select>
        </label>
        <label className={styles.checkboxField}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>Enabled (shown on the login picker)</span>
        </label>
      </div>

      {kind === "saml" ? (
        <fieldset className={styles.fieldset}>
          <legend>IdP configuration</legend>
          <TextField label="IdP entity ID" value={samlEntityId} onChange={(e) => setSamlEntityId(e.target.value)} />
          <TextField label="IdP SSO URL" value={samlSsoUrl} onChange={(e) => setSamlSsoUrl(e.target.value)} />
          <label className={styles.textareaField}>
            <span className={styles.label}>IdP x509 signing certificate (PEM, no BEGIN/END lines needed)</span>
            <textarea className={styles.textarea} rows={4} value={samlCert} onChange={(e) => setSamlCert(e.target.value)} />
          </label>
          <div className={styles.row}>
            <TextField label="Email attribute" value={samlEmailAttr} onChange={(e) => setSamlEmailAttr(e.target.value)} />
            <TextField label="Display name attribute" value={samlNameAttr} onChange={(e) => setSamlNameAttr(e.target.value)} />
          </div>
        </fieldset>
      ) : (
        <fieldset className={styles.fieldset}>
          <legend>Directory configuration</legend>
          <TextField
            label="Server URI"
            value={ldapUri}
            onChange={(e) => setLdapUri(e.target.value)}
            placeholder="ldaps://ldap.example.edu:636"
          />
          <div className={styles.row}>
            <TextField label="Bind DN (service account)" value={ldapBindDn} onChange={(e) => setLdapBindDn(e.target.value)} />
            <TextField
              label="Bind password"
              type="password"
              value={ldapBindPassword}
              onChange={(e) => setLdapBindPassword(e.target.value)}
              placeholder={initial?.ldap_has_bind_password ? "Leave blank to keep the current password" : ""}
            />
          </div>
          <TextField label="User search base" value={ldapSearchBase} onChange={(e) => setLdapSearchBase(e.target.value)} placeholder="dc=example,dc=edu" />
          <TextField
            label="User search filter"
            value={ldapSearchFilter}
            onChange={(e) => setLdapSearchFilter(e.target.value)}
            hint="%(user)s is replaced with the submitted username. Active Directory example: (sAMAccountName=%(user)s)"
          />
          <div className={styles.row}>
            <TextField label="Email attribute" value={ldapEmailAttr} onChange={(e) => setLdapEmailAttr(e.target.value)} />
            <TextField label="Display name attribute" value={ldapNameAttr} onChange={(e) => setLdapNameAttr(e.target.value)} />
          </div>
          <label className={styles.checkboxField}>
            <input type="checkbox" checked={ldapStartTls} onChange={(e) => setLdapStartTls(e.target.checked)} />
            <span>Use STARTTLS (for a plain ldap:// URI)</span>
          </label>
        </fieldset>
      )}

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {initial ? "Save changes" : "Add provider"}
        </Button>
      </div>
    </form>
  );
}
