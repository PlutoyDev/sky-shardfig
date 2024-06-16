// Using Cloudflare Pages API Count number of deployments under sky-shardfig project
import { DateTime } from 'luxon';

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = '8296e3f54f477c165d65904e2e336806';
const projectNames = ['sky-shards', 'sky-shardfig'];

interface DeploymentResponse {
  result: Deployment[];
  success: boolean;
  errors: string[];
  messages: string[];
  result_info: {
    page: number;
    per_page: number;
    count: number;
    total_pages: number;
    total_count: number;
  };
}

interface Deployment {
  id: string;
  created_on: string;
  is_skipped: boolean;
}

const fetchDeployments = async (projectId: string, page: number): Promise<DeploymentResponse> => {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectId}/deployments?page=${page}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return res.json() as Promise<DeploymentResponse>;
};

const countDeploymentsForThisMonth = async () => {
  const now = DateTime.now();
  const [a, b] = await Promise.all(
    projectNames.map(async projectName => {
      let page = 1;
      let deploymentCount = 0;
      while (true) {
        const res = await fetchDeployments(projectName, page);
        const deploymentsThisMonth = res.result.filter(deployment =>
          DateTime.fromISO(deployment.created_on).hasSame(now, 'month'),
        );
        console.log(`Deployments for ${projectName} on page ${page}: ${deploymentsThisMonth.length}`);
        const unskipCount = deploymentsThisMonth.filter(deployment => !deployment.is_skipped).length;
        console.log(`Unskipped deployments for ${projectName} on page ${page}: ${unskipCount}`);
        deploymentCount += unskipCount;
        if (deploymentsThisMonth.length < res.result_info.per_page) {
          break;
        }
        page++;
      }
      return deploymentCount;
    }),
  );

  console.log(`Total deployments for this month: sky-shards: ${a}, sky-shardfig: ${b}, total: ${a + b}`);
  console.log('Number of deployments left in this month:', 200 - a - b);
};

await countDeploymentsForThisMonth();
console.log('Number of days left in this month:', DateTime.now().endOf('month').diffNow('days').days);
// Output: Total deployments for this month: 5
