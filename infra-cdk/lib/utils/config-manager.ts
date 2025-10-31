import * as fs from "fs"
import * as path from "path"
import * as yaml from "yaml"

export interface AppConfig {
  stack_name_base: string
  admin_user_email?: string | null
  backend: {
    pattern: string
  }
}

export class ConfigManager {
  private config: AppConfig

  constructor(configFile: string) {
    this.config = this._loadConfig(configFile)
  }

  private _loadConfig(configFile: string): AppConfig {
    const configPath = path.join(__dirname, "..", "..", configFile)

    if (!fs.existsSync(configPath)) {
      // Return default configuration if file doesn't exist
      return {
        stack_name_base: "genaiid-agentcore-starter-pack",
        admin_user_email: null,
        backend: {
          pattern: "strands-single-agent",
        },
      }
    }

    try {
      const fileContent = fs.readFileSync(configPath, "utf8")
      const parsedConfig = yaml.parse(fileContent) as AppConfig

      // Validate required fields and provide defaults
      return {
        stack_name_base: parsedConfig.stack_name_base || "genaiid-agentcore-starter-pack",
        admin_user_email: parsedConfig.admin_user_email || null,
        backend: {
          pattern: parsedConfig.backend?.pattern || "strands-single-agent",
        },
      }
    } catch (error) {
      throw new Error(`Failed to parse configuration file ${configPath}: ${error}`)
    }
  }

  public getProps(): AppConfig {
    return this.config
  }

  public get(key: string, defaultValue?: any): any {
    const keys = key.split(".")
    let value: any = this.config

    for (const k of keys) {
      if (typeof value === "object" && value !== null && k in value) {
        value = value[k]
      } else {
        return defaultValue
      }
    }

    return value
  }
}
