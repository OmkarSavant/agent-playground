import { NextRequest } from "next/server";

interface WorldContextRequest {
  taskId: string;
  cookie: string;
  enabledServices: string[];
}

interface ServiceData {
  name: string;
  displayName: string;
  data: Record<string, unknown>;
  error?: string;
}

// Execute Python code via AppWorld API
async function executeCode(
  taskId: string,
  cookie: string,
  code: string,
  baseUrl: string
): Promise<{ output?: string; error?: string }> {
  try {
    const response = await fetch(`${baseUrl}/api/appworld`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "execute",
        task_id: taskId,
        code,
        cookie,
      }),
    });

    const data = await response.json();

    if (data.error) {
      return { error: data.error };
    }

    return { output: data.output };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

// Parse JSON output from API call
function parseOutput(output: string | undefined): unknown {
  if (!output) return null;
  if (output.includes("Exception") || output.includes("Traceback")) {
    return null;
  }
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

// Get credentials for a service
function getCredentialsForService(
  passwords: Array<{ account_name: string; password: string }>,
  serviceName: string,
  email: string
): { username: string; password: string } | null {
  const cred = passwords.find((p) => p.account_name === serviceName);
  if (!cred) return null;
  return { username: email, password: cred.password };
}

export async function POST(request: NextRequest) {
  try {
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("host") || "localhost:3000";
    const baseUrl = `${protocol}://${host}`;

    const body: WorldContextRequest = await request.json();
    const { taskId, cookie, enabledServices } = body;

    if (!taskId || !cookie) {
      return Response.json(
        { error: "Missing taskId or cookie" },
        { status: 400 }
      );
    }

    const results: {
      profile: unknown;
      credentials: unknown;
      services: ServiceData[];
    } = {
      profile: null,
      credentials: null,
      services: [],
    };

    // Get user profile
    const profileResult = await executeCode(
      taskId,
      cookie,
      "print(apis.supervisor.show_profile())",
      baseUrl
    );
    results.profile = parseOutput(profileResult.output);

    // Get credentials
    const credResult = await executeCode(
      taskId,
      cookie,
      "print(apis.supervisor.show_account_passwords())",
      baseUrl
    );
    const passwords = parseOutput(credResult.output) as Array<{ account_name: string; password: string }> | null;
    results.credentials = passwords;

    // Get user email for logins
    const email = (results.profile as { email?: string })?.email || "";

    // Fetch data for each enabled service
    for (const service of enabledServices) {
      const serviceData: ServiceData = {
        name: service,
        displayName: getDisplayName(service),
        data: {},
      };

      try {
        switch (service) {
          case "spotify": {
            const creds = getCredentialsForService(passwords || [], "spotify", email);
            if (creds) {
              const likedSongs = await executeCode(
                taskId,
                cookie,
                `login = apis.spotify.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.spotify.show_liked_songs(access_token=access_token))`,
                baseUrl
              );
              serviceData.data.likedSongs = parseOutput(likedSongs.output);

              const account = await executeCode(
                taskId,
                cookie,
                `login = apis.spotify.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.spotify.show_account(access_token=access_token))`,
                baseUrl
              );
              serviceData.data.account = parseOutput(account.output);
            }
            break;
          }

          case "gmail": {
            const creds = getCredentialsForService(passwords || [], "gmail", email);
            if (creds) {
              const inbox = await executeCode(
                taskId,
                cookie,
                `login = apis.gmail.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.gmail.show_inbox_threads(access_token=access_token))`,
                baseUrl
              );
              serviceData.data.inboxThreads = parseOutput(inbox.output);

              const outbox = await executeCode(
                taskId,
                cookie,
                `login = apis.gmail.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.gmail.show_outbox_threads(access_token=access_token))`,
                baseUrl
              );
              serviceData.data.outboxThreads = parseOutput(outbox.output);
            }
            break;
          }

          case "venmo": {
            const creds = getCredentialsForService(passwords || [], "venmo", email);
            if (creds) {
              // Login first
              await executeCode(
                taskId,
                cookie,
                `print(apis.venmo.login(username="${creds.username}", password="${creds.password}"))`,
                baseUrl
              );

              const account = await executeCode(
                taskId,
                cookie,
                "print(apis.venmo.show_account())",
                baseUrl
              );
              serviceData.data.account = parseOutput(account.output);

              const transactions = await executeCode(
                taskId,
                cookie,
                "print(apis.venmo.show_transactions(limit=10))",
                baseUrl
              );
              serviceData.data.recentTransactions = parseOutput(transactions.output);
            }
            break;
          }

          case "amazon": {
            const creds = getCredentialsForService(passwords || [], "amazon", email);
            if (creds) {
              // Login first
              await executeCode(
                taskId,
                cookie,
                `print(apis.amazon.login(email="${creds.username}", password="${creds.password}"))`,
                baseUrl
              );

              const orders = await executeCode(
                taskId,
                cookie,
                "print(apis.amazon.show_orders())",
                baseUrl
              );
              serviceData.data.orders = parseOutput(orders.output);

              const cart = await executeCode(
                taskId,
                cookie,
                "print(apis.amazon.show_cart())",
                baseUrl
              );
              serviceData.data.cart = parseOutput(cart.output);
            }
            break;
          }

          case "todoist": {
            const creds = getCredentialsForService(passwords || [], "todoist", email);
            if (creds) {
              // Login first
              await executeCode(
                taskId,
                cookie,
                `print(apis.todoist.login(email="${creds.username}", password="${creds.password}"))`,
                baseUrl
              );

              const projects = await executeCode(
                taskId,
                cookie,
                "print(apis.todoist.list_projects())",
                baseUrl
              );
              serviceData.data.projects = parseOutput(projects.output);

              const tasks = await executeCode(
                taskId,
                cookie,
                "print(apis.todoist.list_tasks())",
                baseUrl
              );
              serviceData.data.tasks = parseOutput(tasks.output);
            }
            break;
          }

          case "simple_note": {
            const creds = getCredentialsForService(passwords || [], "simple_note", email);
            if (creds) {
              const notes = await executeCode(
                taskId,
                cookie,
                `login = apis.simple_note.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.simple_note.search_notes(access_token=access_token, query=""))`,
                baseUrl
              );
              serviceData.data.notes = parseOutput(notes.output);
            }
            break;
          }

          case "splitwise": {
            const creds = getCredentialsForService(passwords || [], "splitwise", email);
            if (creds) {
              // Login first
              await executeCode(
                taskId,
                cookie,
                `print(apis.splitwise.login(email="${creds.username}", password="${creds.password}"))`,
                baseUrl
              );

              const groups = await executeCode(
                taskId,
                cookie,
                "print(apis.splitwise.list_groups())",
                baseUrl
              );
              serviceData.data.groups = parseOutput(groups.output);

              const friends = await executeCode(
                taskId,
                cookie,
                "print(apis.splitwise.list_friends())",
                baseUrl
              );
              serviceData.data.friends = parseOutput(friends.output);

              const balances = await executeCode(
                taskId,
                cookie,
                "print(apis.splitwise.get_balances())",
                baseUrl
              );
              serviceData.data.balances = parseOutput(balances.output);
            }
            break;
          }

          case "phone": {
            // Phone doesn't need login
            const contacts = await executeCode(
              taskId,
              cookie,
              "print(apis.phone.show_contacts())",
              baseUrl
            );
            serviceData.data.contacts = parseOutput(contacts.output);

            const callLog = await executeCode(
              taskId,
              cookie,
              "print(apis.phone.show_call_log())",
              baseUrl
            );
            serviceData.data.callLog = parseOutput(callLog.output);

            const sms = await executeCode(
              taskId,
              cookie,
              "print(apis.phone.show_sms())",
              baseUrl
            );
            serviceData.data.sms = parseOutput(sms.output);
            break;
          }

          case "file_system": {
            const creds = getCredentialsForService(passwords || [], "file_system", email);
            if (creds) {
              // Login first
              await executeCode(
                taskId,
                cookie,
                `print(apis.file_system.login(username="${creds.username}", password="${creds.password}"))`,
                baseUrl
              );

              const files = await executeCode(
                taskId,
                cookie,
                'print(apis.file_system.list_files(path="/"))',
                baseUrl
              );
              serviceData.data.rootFiles = parseOutput(files.output);
            }
            break;
          }
        }
      } catch (error) {
        serviceData.error = error instanceof Error ? error.message : "Unknown error";
      }

      // Only add if we got some data
      if (Object.keys(serviceData.data).length > 0 || serviceData.error) {
        results.services.push(serviceData);
      }
    }

    return Response.json(results);
  } catch (error) {
    console.error("World context error:", error);
    return Response.json(
      {
        error: "Failed to load world context",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

function getDisplayName(service: string): string {
  const names: Record<string, string> = {
    spotify: "Spotify",
    gmail: "Gmail",
    venmo: "Venmo",
    amazon: "Amazon",
    todoist: "Todoist",
    simple_note: "SimpleNote",
    splitwise: "Splitwise",
    phone: "Phone",
    file_system: "File System",
  };
  return names[service] || service;
}
