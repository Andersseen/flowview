use clap::{Parser, Subcommand, ValueEnum};
use flowview_compiler::{
    compile, compile_static_artifact, render_static, CompileOptions, Diagnostic,
    DiagnosticFormatter, StaticRenderOptions,
};
use std::{
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process,
};

#[derive(Parser)]
#[command(name = "flowview")]
#[command(about = "Compile flowview templates to JavaScript or render them to static HTML")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Clone, Copy, ValueEnum)]
enum DiagnosticFormat {
    Human,
    Json,
}

#[derive(Clone, Copy, PartialEq, Eq, ValueEnum)]
enum Target {
    /// JavaScript module exporting `render(context)` (default)
    Js,
    /// Final HTML rendered natively from a JSON context
    StaticHtml,
}

#[derive(Subcommand)]
enum Command {
    /// Compile a flowview template file
    Compile {
        /// Path to the .flow template file
        input: String,

        /// Output file path
        #[arg(long)]
        out: Option<String>,

        /// Output target
        #[arg(long, value_enum, default_value_t = Target::Js)]
        target: Target,

        /// JSON file used as `context` (static-html target only; defaults to `{}`)
        #[arg(long)]
        data: Option<String>,

        /// Runtime module import path (js target only)
        #[arg(long, default_value = "@flowview/runtime")]
        runtime: String,

        /// Filename shown in generated diagnostics (useful when compiling stdin)
        #[arg(long)]
        display_name: Option<String>,

        /// Number of source lines to add to diagnostic locations
        #[arg(long, default_value_t = 0)]
        line_offset: usize,

        /// Emit JavaScript code and its Source Map v3 as a JSON object
        #[arg(long)]
        source_map: bool,

        /// Normalized source identifier stored in the source map
        #[arg(long)]
        source_map_name: Option<String>,

        /// Read `{ source, sourceMapSourceContent }` JSON from stdin
        #[arg(long)]
        source_map_input_json: bool,

        /// Host column offset for a template beginning on the first mapped line
        #[arg(long, default_value_t = 0)]
        source_map_column_offset: usize,

        /// Format used for compiler diagnostics
        #[arg(long, value_enum, default_value_t = DiagnosticFormat::Human)]
        diagnostic_format: DiagnosticFormat,
    },
    /// Generate or verify a precompiled static template artifact
    Precompile {
        /// Path to the .flow template file
        input: String,
        /// Artifact output path (required for both generation and --check)
        #[arg(long)]
        out: String,
        /// Logical source name stored in runtime diagnostics; must be relative
        #[arg(long)]
        display_name: Option<String>,
        /// Verify that --out exactly matches canonical compiler output
        #[arg(long)]
        check: bool,
        /// Format used for compiler diagnostics
        #[arg(long, value_enum, default_value_t = DiagnosticFormat::Human)]
        diagnostic_format: DiagnosticFormat,
    },
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Command::Compile {
            input,
            out,
            target,
            data,
            runtime,
            display_name,
            line_offset,
            source_map,
            source_map_name,
            source_map_input_json,
            source_map_column_offset,
            diagnostic_format,
        } => compile_file(
            &input,
            out.as_deref(),
            target,
            data.as_deref(),
            &runtime,
            display_name.as_deref(),
            line_offset,
            source_map,
            source_map_name.as_deref(),
            source_map_input_json,
            source_map_column_offset,
            diagnostic_format,
        ),
        Command::Precompile {
            input,
            out,
            display_name,
            check,
            diagnostic_format,
        } => precompile_file(
            &input,
            &out,
            display_name.as_deref(),
            check,
            diagnostic_format,
        ),
    }
}

fn precompile_file(
    input: &str,
    out: &str,
    display_name: Option<&str>,
    check: bool,
    format: DiagnosticFormat,
) {
    let input_path = Path::new(input);
    if input_path.extension().and_then(|ext| ext.to_str()) != Some("flow") {
        eprintln!("{}: expected a .flow file", input);
        process::exit(1);
    }
    let source = match fs::read_to_string(input_path) {
        Ok(source) => source,
        Err(error) => {
            eprintln!("Failed to read {}: {}", input, error);
            process::exit(1);
        }
    };
    let logical_name = display_name.map(str::to_owned).unwrap_or_else(|| {
        input_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("template.flow")
            .to_owned()
    });
    if Path::new(&logical_name).is_absolute()
        || logical_name.starts_with(['/', '\\'])
        || logical_name.as_bytes().get(1) == Some(&b':')
        || logical_name.split(['/', '\\']).any(|part| part == "..")
    {
        eprintln!("--display-name must be a logical relative source name");
        process::exit(1);
    }
    let generated = match compile_static_artifact(
        &source,
        StaticRenderOptions::default().with_filename(logical_name.clone()),
    ) {
        Ok(output) => output,
        Err(diagnostics) => {
            report(&diagnostics, &logical_name, 0, format);
            process::exit(1);
        }
    };
    report(&generated.warnings, &logical_name, 0, format);
    let output_path = Path::new(out);
    if check {
        let current = match fs::read(output_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                eprintln!(
                    "{}: AOT artifact is missing; run `flowview precompile {} --out {}`",
                    out, input, out
                );
                process::exit(1);
            }
            Err(error) => {
                eprintln!("Failed to read {}: {}", out, error);
                process::exit(1);
            }
        };
        if current != generated.bytes {
            eprintln!(
                "{}: AOT artifact is stale; run `flowview precompile {} --out {}`",
                out, input, out
            );
            process::exit(1);
        }
        return;
    }
    if let Err(error) = write_atomic(output_path, &generated.bytes) {
        eprintln!("Failed to write {}: {}", out, error);
        process::exit(1);
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    static NEXT_TEMP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let mut temp_path = PathBuf::new();
    let mut file = None;
    for _ in 0..32 {
        let id = NEXT_TEMP.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        temp_path = parent.join(format!(".{name}.{}.{}.tmp", process::id(), id));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(created) => {
                file = Some(created);
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    let mut file = file.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a temporary output file",
        )
    })?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp_path, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn compile_file(
    input: &str,
    out: Option<&str>,
    target: Target,
    data: Option<&str>,
    runtime: &str,
    display_name: Option<&str>,
    line_offset: usize,
    source_map: bool,
    source_map_name: Option<&str>,
    source_map_input_json: bool,
    source_map_column_offset: usize,
    diagnostic_format: DiagnosticFormat,
) {
    let path = Path::new(input);

    if input != "-" && path.extension().and_then(|ext| ext.to_str()) != Some("flow") {
        eprintln!("{}: expected a .flow file", input);
        process::exit(1);
    }

    if data.is_some() && target != Target::StaticHtml {
        eprintln!("--data is only valid with --target static-html");
        process::exit(1);
    }

    if source_map && target != Target::Js {
        eprintln!("--source-map is only valid with the js target");
        process::exit(1);
    }

    if source_map_input_json && (!source_map || input != "-") {
        eprintln!("--source-map-input-json requires --source-map and stdin input (`-`)");
        process::exit(1);
    }

    let (source, source_map_source_content) = if input == "-" {
        let mut source = String::new();
        if let Err(error) = io::stdin().read_to_string(&mut source) {
            eprintln!("Failed to read stdin: {}", error);
            process::exit(1);
        }
        if source_map_input_json {
            let input = match serde_json::from_str::<serde_json::Value>(&source) {
                Ok(input) => input,
                Err(error) => {
                    eprintln!("Invalid source-map compiler input: {}", error);
                    process::exit(1);
                }
            };
            let Some(source) = input.get("source").and_then(serde_json::Value::as_str) else {
                eprintln!("Source-map compiler input must contain a string `source`");
                process::exit(1);
            };
            let Some(source_content) = input
                .get("sourceMapSourceContent")
                .and_then(serde_json::Value::as_str)
            else {
                eprintln!(
                    "Source-map compiler input must contain a string `sourceMapSourceContent`"
                );
                process::exit(1);
            };
            (source.to_string(), Some(source_content.to_string()))
        } else {
            (source, None)
        }
    } else {
        match fs::read_to_string(path) {
            Ok(source) => (source, None),
            Err(error) => {
                eprintln!("Failed to read {}: {}", input, error);
                process::exit(1);
            }
        }
    };

    let diagnostic_name = display_name.unwrap_or(input);

    let result = match target {
        Target::Js => {
            let mut options = CompileOptions::new(runtime).with_filename(diagnostic_name);
            options.source_map = source_map;
            options.source_map_line_offset = line_offset;
            options.source_map_filename = source_map_name.map(str::to_string);
            options.source_map_source_content = source_map_source_content;
            options.source_map_column_offset = source_map_column_offset;
            compile(&source, options)
                .map(|output| (output.code, output.source_map, output.warnings))
        }
        Target::StaticHtml => {
            let context = load_context(data);
            let options = StaticRenderOptions::default().with_filename(diagnostic_name);
            render_static(&source, &context, options)
                .map(|output| (output.html, None, output.warnings))
        }
    };

    match result {
        Ok((code, map, warnings)) => {
            report(&warnings, diagnostic_name, line_offset, diagnostic_format);

            if let Some(out_path) = out {
                if let Err(error) = fs::write(out_path, code) {
                    eprintln!("Failed to write {}: {}", out_path, error);
                    process::exit(1);
                }
                if let Some(map) = map {
                    if let Err(error) = fs::write(format!("{}.map", out_path), map) {
                        eprintln!("Failed to write {}.map: {}", out_path, error);
                        process::exit(1);
                    }
                }
            } else {
                if source_map {
                    let map = map.map(|json| {
                        serde_json::from_str::<serde_json::Value>(&json)
                            .expect("compiler emitted valid source map JSON")
                    });
                    let payload = serde_json::json!({ "code": code, "sourceMap": map });
                    println!("{}", payload);
                } else {
                    print!("{}", code);
                }
            }
        }
        Err(diagnostics) => {
            report(
                &diagnostics,
                diagnostic_name,
                line_offset,
                diagnostic_format,
            );
            process::exit(1);
        }
    }
}

fn load_context(data: Option<&str>) -> serde_json::Value {
    let Some(data_path) = data else {
        return serde_json::json!({});
    };
    if data_path == "-" {
        eprintln!("--data cannot read stdin; stdin is reserved for the template");
        process::exit(1);
    }
    let text = match fs::read_to_string(data_path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!("Failed to read {}: {}", data_path, error);
            process::exit(1);
        }
    };
    match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("Invalid JSON in {}: {}", data_path, error);
            process::exit(1);
        }
    }
}

fn report(
    diagnostics: &[Diagnostic],
    filename: &str,
    line_offset: usize,
    format: DiagnosticFormat,
) {
    if diagnostics.is_empty() {
        return;
    }
    let formatter = DiagnosticFormatter::new(diagnostics, filename, line_offset);
    match format {
        DiagnosticFormat::Human => eprint!("{}", formatter.format_human()),
        DiagnosticFormat::Json => eprintln!("{}", formatter.format_json()),
    }
}
