import { api } from "../../api/client";

/* The "no domain yet" path for the OpenSearch store, shared by the wizard
   and Settings: a CloudFormation template download with the user's IAM
   identity pre-filled as the domain's master user, and the deploy command.
   With an empty arn the template keeps its placeholder for hand-editing. */
export function OpensearchDeployHint({
  arn,
  profile,
  region,
}: {
  arn: string;
  profile: string;
  region: string;
}) {
  return (
    <div className="text-xs text-ink-soft">
      <p>
        No domain yet?{" "}
        <a
          href={api.opensearchTemplateUrl(arn)}
          download
          className="font-semibold text-ink underline underline-offset-2"
        >
          Download the CloudFormation template
        </a>{" "}
        with your identity pre-filled as the domain&apos;s master user, then:
      </p>
      <pre className="mono mt-2 overflow-x-auto rounded-lg border border-line bg-lighttable p-3 text-ink">
{`aws cloudformation deploy \\
  --template-file ingestlib-opensearch.yaml \\
  --stack-name ingestlib-opensearch \\
  --profile ${profile} --region ${region}`}
      </pre>
      <p className="mt-2">
        One r8g.medium.search node, about $0.10 per hour. Delete the stack when
        idle; backfill rebuilds the index from S3 anytime. The deploy permissions
        are part of the wizard&apos;s IAM policy, so the order is: continue,
        attach the policy, deploy, then come back and paste the endpoint here.
      </p>
    </div>
  );
}
