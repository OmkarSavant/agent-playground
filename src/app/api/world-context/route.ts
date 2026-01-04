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
              if (likedSongs.output?.includes("Exception")) {
                serviceData.error = "Login failed";
                break;
              }
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
            } else {
              serviceData.error = "No credentials found";
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
              if (inbox.output?.includes("Exception")) {
                serviceData.error = "Login failed";
                break;
              }
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
            } else {
              serviceData.error = "No credentials found";
            }
            break;
          }

          case "venmo": {
            const creds = getCredentialsForService(passwords || [], "venmo", email);
            if (creds) {
              const account = await executeCode(
                taskId,
                cookie,
                `login = apis.venmo.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.venmo.show_account(access_token=access_token))`,
                baseUrl
              );
              if (account.output?.includes("Exception")) {
                serviceData.error = "Login failed";
                break;
              }
              serviceData.data.account = parseOutput(account.output);

              const transactions = await executeCode(
                taskId,
                cookie,
                `login = apis.venmo.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.venmo.show_transactions(access_token=access_token))`,
                baseUrl
              );
              serviceData.data.recentTransactions = parseOutput(transactions.output);
            } else {
              serviceData.error = "No credentials found";
            }
            break;
          }

          case "amazon": {
            const creds = getCredentialsForService(passwords || [], "amazon", email);
            if (creds) {
              const orders = await executeCode(
                taskId,
                cookie,
                `login = apis.amazon.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.amazon.show_orders(access_token=access_token))`,
                baseUrl
              );
              if (orders.output?.includes("Exception")) {
                serviceData.error = "Login failed";
                break;
              }
              serviceData.data.orders = parseOutput(orders.output);

              const cart = await executeCode(
                taskId,
                cookie,
                `login = apis.amazon.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.amazon.show_cart(access_token=access_token))`,
                baseUrl
              );
              serviceData.data.cart = parseOutput(cart.output);
            } else {
              serviceData.error = "No credentials found";
            }
            break;
          }

          case "todoist": {
            const creds = getCredentialsForService(passwords || [], "todoist", email);
            if (creds) {
              const projects = await executeCode(
                taskId,
                cookie,
                `login = apis.todoist.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.todoist.show_projects(access_token=access_token))`,
                baseUrl
              );
              if (projects.output?.includes("Exception")) {
                serviceData.error = "Login failed";
                break;
              }
              serviceData.data.projects = parseOutput(projects.output);
            } else {
              serviceData.error = "No credentials found";
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
              if (notes.output?.includes("Exception")) {
                serviceData.error = "Login failed";
                break;
              }
              serviceData.data.notes = parseOutput(notes.output);
            } else {
              serviceData.error = "No credentials found";
            }
            break;
          }

          case "splitwise": {
            const creds = getCredentialsForService(passwords || [], "splitwise", email);
            if (creds) {
              const groups = await executeCode(
                taskId,
                cookie,
                `login = apis.splitwise.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.splitwise.show_groups(access_token=access_token))`,
                baseUrl
              );
              if (groups.output?.includes("Exception")) {
                serviceData.error = "Login failed";
                break;
              }
              serviceData.data.groups = parseOutput(groups.output);

              const activity = await executeCode(
                taskId,
                cookie,
                `login = apis.splitwise.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.splitwise.show_activity(access_token=access_token))`,
                baseUrl
              );
              serviceData.data.activity = parseOutput(activity.output);

              const balances = await executeCode(
                taskId,
                cookie,
                `login = apis.splitwise.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.splitwise.show_people_balance(access_token=access_token))`,
                baseUrl
              );
              serviceData.data.balances = parseOutput(balances.output);
            } else {
              serviceData.error = "No credentials found";
            }
            break;
          }

          case "phone": {
            const creds = getCredentialsForService(passwords || [], "phone", email);
            if (creds) {
              // Phone uses phone_number as username
              const phoneNumber = (results.profile as { phone_number?: string })?.phone_number || "";

              const contacts = await executeCode(
                taskId,
                cookie,
                `login = apis.phone.login(username="${phoneNumber}", password="${creds.password}")
access_token = login["access_token"]
print(apis.phone.search_contacts(access_token=access_token))`,
                baseUrl
              );
              if (contacts.output?.includes("Exception")) {
                serviceData.error = "Login failed";
                break;
              }
              serviceData.data.contacts = parseOutput(contacts.output);

              const textMessages = await executeCode(
                taskId,
                cookie,
                `login = apis.phone.login(username="${phoneNumber}", password="${creds.password}")
access_token = login["access_token"]
print(apis.phone.search_text_messages(access_token=access_token))`,
                baseUrl
              );
              serviceData.data.textMessages = parseOutput(textMessages.output);

              const voiceMessages = await executeCode(
                taskId,
                cookie,
                `login = apis.phone.login(username="${phoneNumber}", password="${creds.password}")
access_token = login["access_token"]
print(apis.phone.search_voice_messages(access_token=access_token))`,
                baseUrl
              );
              serviceData.data.voiceMessages = parseOutput(voiceMessages.output);
            } else {
              serviceData.error = "No credentials found";
            }
            break;
          }

          case "file_system": {
            const creds = getCredentialsForService(passwords || [], "file_system", email);
            if (creds) {
              const files = await executeCode(
                taskId,
                cookie,
                `login = apis.file_system.login(username="${creds.username}", password="${creds.password}")
access_token = login["access_token"]
print(apis.file_system.show_directory(access_token=access_token, path="/"))`,
                baseUrl
              );
              if (files.output?.includes("Exception")) {
                serviceData.error = "Login failed";
                break;
              }
              serviceData.data.rootDirectory = parseOutput(files.output);
            } else {
              serviceData.error = "No credentials found";
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
