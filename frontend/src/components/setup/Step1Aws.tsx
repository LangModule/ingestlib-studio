import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Patch, WizardState } from "../../routes/Setup";
import { Button, Card, CheckBadge, Field, Select, TextInput, useCheck } from "./ui";

const BEDROCK_REGIONS = [
  "us-east-1", "us-east-2", "us-west-2",
  "eu-west-1", "eu-central-1", "ap-southeast-2", "ap-northeast-1",
];

export function Step1Aws({
  state,
  patch,
  onNext,
}: {
  state: WizardState;
  patch: Patch;
  onNext: () => void;
}) {
  const [profiles, setProfiles] = useState<string[] | null>(null);

  const loadProfiles = useCallback(() => {
    api.awsProfiles().then((body) => setProfiles(body.profiles));
  }, []);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // When profiles arrive and none is chosen yet, preselect the first one.
  useEffect(() => {
    if (profiles && profiles.length > 0 && !state.profile) {
      patch({ profile: profiles[0] });
    }
  }, [profiles, state.profile, patch]);

  const runCheck = useCallback(async () => {
    const result = await api.checkAws(state.profile, state.region);
    if (result.ok) {
      patch({
        accountId: String(result.data.account_id ?? ""),
        arn: String(result.data.arn ?? ""),
      });
    }
    return result;
  }, [state.profile, state.region, patch]);
  const [check, verify] = useCheck(runCheck);

  const noCredentials = profiles !== null && profiles.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold">Connect AWS</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Your profile from ~/.aws/credentials, with Bedrock access. This is the only
          prerequisite the studio cannot set up for you.
        </p>
      </header>

      {noCredentials && (
        <Card className="border-fail bg-fail-soft">
          <p className="text-sm font-medium text-fail">No AWS credentials found</p>
          <p className="mt-2 text-sm">Install the AWS CLI and configure a profile, then retry:</p>
          <pre className="mono mt-2 rounded-lg border border-line bg-lighttable p-3 text-xs text-ink">
{`brew install awscli               # macOS
aws configure --profile my-name   # any name you like`}
          </pre>
          <p className="mt-2 text-xs text-ink-soft">
            The profile name is a local label of your choosing; it stores your access key ID
            and secret key in ~/.aws/credentials, and only the keys identify your account.
          </p>
          <Button kind="ghost" className="mt-3" onClick={loadProfiles}>
            Retry
          </Button>
        </Card>
      )}

      <Card className="flex flex-col gap-4">
        <Field label="Profile" hint="section name from ~/.aws/credentials">
          {profiles && profiles.length > 0 ? (
            <Select value={state.profile} onChange={(e) => patch({ profile: e.target.value })}>
              {profiles.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </Select>
          ) : (
            <TextInput
              value={state.profile}
              placeholder="my-profile"
              onChange={(e) => patch({ profile: e.target.value })}
            />
          )}
        </Field>
        <Field label="Region" hint="where Bedrock Nova runs; us-east-1 is recommended">
          <Select value={state.region} onChange={(e) => patch({ region: e.target.value })}>
            {BEDROCK_REGIONS.map((region) => (
              <option key={region}>{region}</option>
            ))}
          </Select>
        </Field>
        <Field label="Account ID" hint="filled in automatically by the check">
          <TextInput value={state.accountId} readOnly className="mono bg-ground" />
        </Field>
        <div className="flex items-center gap-3">
          <Button onClick={verify} disabled={!state.profile || check.status === "running"}>
            {check.status === "running" ? "Checking…" : "Verify identity"}
          </Button>
          <CheckBadge state={check} />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={check.status !== "ok"}>
          Next: Choices →
        </Button>
      </div>
    </div>
  );
}
