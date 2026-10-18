using System.Globalization;
using System.Linq.Expressions;
using System.Text;
using EspressoLog.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("Db") ?? "Data Source=db/espresso.db";
EnsureDbDirectory(connectionString, builder.Environment.ContentRootPath);
builder.Services.AddDbContext<AppDb>(o => o.UseSqlite(connectionString));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<AppDb>().Database.Migrate();
}

app.UseDefaultFiles();
// Always revalidate (cheap ETag check) so a redeploy never mixes old and new files.
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
});

var api = app.MapGroup("/api");

// ---------- shots ----------

api.MapGet("/shots", async (AppDb db, int? beanId, int? limit) =>
{
    var q = db.Shots.AsNoTracking();
    if (beanId is { } id) q = q.Where(s => s.BeanId == id);
    q = q.OrderByDescending(s => s.CreatedAt).ThenByDescending(s => s.Id);
    if (limit is > 0) q = q.Take(limit.Value);
    return await q.Select(ShotDto.Projection).ToListAsync();
});

api.MapGet("/shots/{id:int}", async (AppDb db, int id) =>
    await db.Shots.Where(s => s.Id == id).Select(ShotDto.Projection).FirstOrDefaultAsync() is { } shot
        ? Results.Ok(shot)
        : Results.NotFound());

api.MapPost("/shots", async (AppDb db, ShotInput input) =>
{
    if (await input.ValidateAsync(db) is { Count: > 0 } errors) return Results.ValidationProblem(errors);
    var shot = new Shot { CreatedAt = input.CreatedAt?.ToUniversalTime() ?? DateTime.UtcNow };
    input.ApplyTo(shot);
    db.Shots.Add(shot);
    await db.SaveChangesAsync();
    await ShotInput.KeepSingleBest(db, shot);
    return Results.Created($"/api/shots/{shot.Id}", await db.Shots.Where(s => s.Id == shot.Id).Select(ShotDto.Projection).FirstAsync());
});

api.MapPut("/shots/{id:int}", async (AppDb db, int id, ShotInput input) =>
{
    if (await input.ValidateAsync(db) is { Count: > 0 } errors) return Results.ValidationProblem(errors);
    var shot = await db.Shots.FindAsync(id);
    if (shot is null) return Results.NotFound();
    if (input.CreatedAt is { } createdAt) shot.CreatedAt = createdAt.ToUniversalTime();
    input.ApplyTo(shot);
    await db.SaveChangesAsync();
    await ShotInput.KeepSingleBest(db, shot);
    return Results.Ok(await db.Shots.Where(s => s.Id == id).Select(ShotDto.Projection).FirstAsync());
});

api.MapDelete("/shots/{id:int}", async (AppDb db, int id) =>
    await db.Shots.Where(s => s.Id == id).ExecuteDeleteAsync() > 0 ? Results.NoContent() : Results.NotFound());

// ---------- beans ----------

api.MapGet("/beans", async (AppDb db, bool? includeFinished) =>
{
    var q = db.Beans.AsNoTracking();
    if (includeFinished != true) q = q.Where(b => !b.Finished);
    var beans = await q.Select(BeanDto.Projection).ToListAsync();
    return beans
        .OrderBy(b => b.Finished)
        .ThenByDescending(b => b.LastUsedAt ?? b.CreatedAt)
        .ThenByDescending(b => b.Id);
});

api.MapGet("/beans/{id:int}", async (AppDb db, int id) =>
    await db.Beans.Where(b => b.Id == id).Select(BeanDto.Projection).FirstOrDefaultAsync() is { } bean
        ? Results.Ok(bean)
        : Results.NotFound());

api.MapPost("/beans", async (AppDb db, BeanInput input) =>
{
    if (input.Validate() is { Count: > 0 } errors) return Results.ValidationProblem(errors);
    var bean = new Bean { CreatedAt = DateTime.UtcNow };
    input.ApplyTo(bean);
    db.Beans.Add(bean);
    await db.SaveChangesAsync();
    return Results.Created($"/api/beans/{bean.Id}", await db.Beans.Where(b => b.Id == bean.Id).Select(BeanDto.Projection).FirstAsync());
});

api.MapPut("/beans/{id:int}", async (AppDb db, int id, BeanInput input) =>
{
    if (input.Validate() is { Count: > 0 } errors) return Results.ValidationProblem(errors);
    var bean = await db.Beans.FindAsync(id);
    if (bean is null) return Results.NotFound();
    input.ApplyTo(bean);
    await db.SaveChangesAsync();
    return Results.Ok(await db.Beans.Where(b => b.Id == id).Select(BeanDto.Projection).FirstAsync());
});

api.MapDelete("/beans/{id:int}", async (AppDb db, int id) =>
{
    if (await db.Shots.AnyAsync(s => s.BeanId == id))
        return Results.Problem("These beans have logged shots. Mark them as finished instead.", statusCode: 409);
    return await db.Beans.Where(b => b.Id == id).ExecuteDeleteAsync() > 0 ? Results.NoContent() : Results.NotFound();
});

// ---------- bean photos ----------

// The URL carries ?v=<updatedAt>, so a photo can be cached forever; a new photo gets a new URL.
api.MapGet("/beans/{id:int}/photo", async (AppDb db, int id, HttpContext ctx) =>
{
    var photo = await db.BeanPhotos.AsNoTracking().FirstOrDefaultAsync(p => p.BeanId == id);
    if (photo is null) return Results.NotFound();
    ctx.Response.Headers.CacheControl = "private, max-age=31536000, immutable";
    return Results.File(photo.Data, photo.ContentType, lastModified: photo.UpdatedAt);
});

api.MapPut("/beans/{id:int}/photo", async (AppDb db, int id, HttpRequest request) =>
{
    const int maxBytes = 8 * 1024 * 1024;
    string[] allowed = ["image/jpeg", "image/png", "image/webp"];
    var contentType = request.ContentType?.Split(';')[0].Trim().ToLowerInvariant();
    if (contentType is null || !allowed.Contains(contentType))
        return Results.Problem("Upload a JPEG, PNG or WebP image.", statusCode: 415);
    if (request.ContentLength > maxBytes)
        return Results.Problem("The photo is too large (max 8 MB).", statusCode: 413);
    if (!await db.Beans.AnyAsync(b => b.Id == id)) return Results.NotFound();

    using var buffer = new MemoryStream();
    await request.Body.CopyToAsync(buffer);
    if (buffer.Length is 0 or > maxBytes) return Results.Problem("The photo is empty or too large (max 8 MB).", statusCode: 400);

    var photo = await db.BeanPhotos.FindAsync(id);
    if (photo is null) db.BeanPhotos.Add(photo = new BeanPhoto { BeanId = id });
    photo.Data = buffer.ToArray();
    photo.ContentType = contentType;
    photo.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync();
    return Results.Ok(new { photo.UpdatedAt });
});

api.MapDelete("/beans/{id:int}/photo", async (AppDb db, int id) =>
    await db.BeanPhotos.Where(p => p.BeanId == id).ExecuteDeleteAsync() > 0 ? Results.NoContent() : Results.NotFound());

// ---------- export ----------

api.MapGet("/shots.csv", async (AppDb db) =>
{
    var shots = await db.Shots.AsNoTracking().Include(s => s.Bean).OrderBy(s => s.CreatedAt).ToListAsync();
    var sb = new StringBuilder("id,created_at,beans,roaster,grind,dose_g,yield_g,time_s,rating,tags,best,notes\n");
    foreach (var s in shots)
    {
        sb.AppendLine(string.Join(',',
            s.Id,
            s.CreatedAt.ToString("o"),
            Csv(s.Bean.Name),
            Csv(s.Bean.Roaster ?? ""),
            s.GrindSetting.ToString(CultureInfo.InvariantCulture),
            s.DoseGrams.ToString(CultureInfo.InvariantCulture),
            s.YieldGrams?.ToString(CultureInfo.InvariantCulture) ?? "",
            s.TimeSeconds,
            s.Rating?.ToString() ?? "",
            Csv(string.Join(' ', s.Tags)),
            s.Best ? "yes" : "",
            Csv(s.Notes ?? "")));
    }
    return Results.File(Encoding.UTF8.GetBytes(sb.ToString()), "text/csv", "espresso-shots.csv");
});

app.Run();

static string Csv(string value) =>
    value.IndexOfAny([',', '"', '\n', '\r']) >= 0 ? $"\"{value.Replace("\"", "\"\"")}\"" : value;

static void EnsureDbDirectory(string connectionString, string contentRoot)
{
    var path = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(connectionString).DataSource;
    var dir = Path.GetDirectoryName(Path.GetFullPath(path, contentRoot));
    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
}

record ShotDto(
    int Id,
    DateTime CreatedAt,
    int BeanId,
    string BeanName,
    double GrindSetting,
    double DoseGrams,
    int TimeSeconds,
    double? YieldGrams,
    int? Rating,
    string? Notes,
    string[] Tags,
    bool Best)
{
    public static readonly Expression<Func<Shot, ShotDto>> Projection = s => new ShotDto(
        s.Id, s.CreatedAt, s.BeanId, s.Bean.Name, s.GrindSetting, s.DoseGrams, s.TimeSeconds, s.YieldGrams, s.Rating, s.Notes,
        s.Tags, s.Best);
}

record ShotInput(
    double GrindSetting,
    double DoseGrams,
    int TimeSeconds,
    int BeanId,
    double? YieldGrams,
    int? Rating,
    string? Notes,
    string[]? Tags,
    bool Best,
    DateTime? CreatedAt)
{
    public async Task<Dictionary<string, string[]>> ValidateAsync(AppDb db)
    {
        var errors = new Dictionary<string, string[]>();
        if (GrindSetting is < 0 or > 1000) errors[nameof(GrindSetting)] = ["Grind setting must be between 0 and 1000."];
        if (DoseGrams is < 5 or > 30) errors[nameof(DoseGrams)] = ["Dose must be between 5 and 30 g."];
        if (TimeSeconds is < 1 or > 120) errors[nameof(TimeSeconds)] = ["Time must be between 1 and 120 s."];
        if (!await db.Beans.AnyAsync(b => b.Id == BeanId)) errors[nameof(BeanId)] = ["Pick beans from the list."];
        if (YieldGrams is < 1 or > 200) errors[nameof(YieldGrams)] = ["Yield must be between 1 and 200 g."];
        if (Rating is < 1 or > 5) errors[nameof(Rating)] = ["Rating must be between 1 and 5."];
        if (Notes?.Length > 2000) errors[nameof(Notes)] = ["Notes are too long."];
        if (Tags?.FirstOrDefault(t => !ShotTags.All.Contains(t)) is { } bad) errors[nameof(Tags)] = [$"Unknown taste tag '{bad}'."];
        return errors;
    }

    public void ApplyTo(Shot shot)
    {
        shot.GrindSetting = GrindSetting;
        shot.DoseGrams = DoseGrams;
        shot.TimeSeconds = TimeSeconds;
        shot.BeanId = BeanId;
        shot.YieldGrams = YieldGrams;
        shot.Rating = Rating;
        shot.Notes = Text.Clean(Notes);
        shot.Tags = ShotTags.All.Where(t => Tags?.Contains(t) == true).ToArray();  // canonical order, no duplicates
        shot.Best = Best;
    }

    // Marking a shot as best un-marks the bag's previous best.
    public static async Task KeepSingleBest(AppDb db, Shot shot)
    {
        if (!shot.Best) return;
        await db.Shots.Where(s => s.BeanId == shot.BeanId && s.Id != shot.Id && s.Best)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.Best, false));
    }
}

record BestShotDto(int Id, DateTime CreatedAt, double GrindSetting, double DoseGrams, int TimeSeconds, double? YieldGrams);

record BeanDto(
    int Id,
    DateTime CreatedAt,
    string Name,
    string? Roaster,
    string? Origin,
    string? PurchasedFrom,
    DateOnly? RoastDate,
    DateOnly? PurchaseDate,
    decimal? Price,
    double? AmountGrams,
    int? Rating,
    string? Review,
    bool Finished,
    int ShotCount,
    double UsedGrams,
    DateTime? LastUsedAt,
    double? LastGrind,
    DateTime? PhotoUpdatedAt,
    BestShotDto? BestShot)
{
    public static readonly Expression<Func<Bean, BeanDto>> Projection = b => new BeanDto(
        b.Id, b.CreatedAt, b.Name, b.Roaster, b.Origin, b.PurchasedFrom, b.RoastDate, b.PurchaseDate,
        b.Price, b.AmountGrams, b.Rating, b.Review, b.Finished,
        b.Shots.Count,
        b.Shots.Sum(s => s.DoseGrams),
        b.Shots.Max(s => (DateTime?)s.CreatedAt),
        b.Shots.OrderByDescending(s => s.CreatedAt).ThenByDescending(s => s.Id).Select(s => (double?)s.GrindSetting).FirstOrDefault(),
        b.Photo == null ? null : b.Photo.UpdatedAt,
        b.Shots.Where(s => s.Best)
            .Select(s => new BestShotDto(s.Id, s.CreatedAt, s.GrindSetting, s.DoseGrams, s.TimeSeconds, s.YieldGrams))
            .FirstOrDefault());
}

record BeanInput(
    string? Name,
    string? Roaster,
    string? Origin,
    string? PurchasedFrom,
    DateOnly? RoastDate,
    DateOnly? PurchaseDate,
    decimal? Price,
    double? AmountGrams,
    int? Rating,
    string? Review,
    bool Finished)
{
    public Dictionary<string, string[]> Validate()
    {
        var errors = new Dictionary<string, string[]>();
        if (string.IsNullOrWhiteSpace(Name)) errors[nameof(Name)] = ["Name is required."];
        foreach (var (field, value) in new[] { (nameof(Name), Name), (nameof(Roaster), Roaster), (nameof(Origin), Origin), (nameof(PurchasedFrom), PurchasedFrom) })
            if (value?.Trim().Length > 200) errors[field] = [$"{field} is too long."];
        if (Price is < 0 or > 100000) errors[nameof(Price)] = ["Price must be between 0 and 100 000."];
        if (AmountGrams is < 1 or > 10000) errors[nameof(AmountGrams)] = ["Amount must be between 1 and 10 000 g."];
        if (Rating is < 1 or > 5) errors[nameof(Rating)] = ["Rating must be between 1 and 5."];
        if (Review?.Length > 2000) errors[nameof(Review)] = ["Review is too long."];
        return errors;
    }

    public void ApplyTo(Bean bean)
    {
        bean.Name = Name!.Trim();
        bean.Roaster = Text.Clean(Roaster);
        bean.Origin = Text.Clean(Origin);
        bean.PurchasedFrom = Text.Clean(PurchasedFrom);
        bean.RoastDate = RoastDate;
        bean.PurchaseDate = PurchaseDate;
        bean.Price = Price;
        bean.AmountGrams = AmountGrams;
        bean.Rating = Rating;
        bean.Review = Text.Clean(Review);
        bean.Finished = Finished;
    }
}

static class Text
{
    public static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
