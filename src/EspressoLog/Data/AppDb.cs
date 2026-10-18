using Microsoft.EntityFrameworkCore;

namespace EspressoLog.Data;

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<Shot> Shots => Set<Shot>();
    public DbSet<Bean> Beans => Set<Bean>();
    public DbSet<BeanPhoto> BeanPhotos => Set<BeanPhoto>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Shot>(e =>
        {
            // SQLite drops DateTimeKind; everything is stored as UTC.
            e.Property(s => s.CreatedAt).HasConversion(
                v => v.ToUniversalTime(),
                v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
            e.Property(s => s.Notes).HasMaxLength(2000);
            e.HasIndex(s => s.CreatedAt);
            e.HasOne(s => s.Bean).WithMany(x => x.Shots).HasForeignKey(s => s.BeanId).OnDelete(DeleteBehavior.Restrict);
        });

        b.Entity<Bean>(e =>
        {
            e.Property(x => x.CreatedAt).HasConversion(
                v => v.ToUniversalTime(),
                v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Roaster).HasMaxLength(200);
            e.Property(x => x.Origin).HasMaxLength(200);
            e.Property(x => x.PurchasedFrom).HasMaxLength(200);
            e.Property(x => x.Review).HasMaxLength(2000);
            // SQLite has no decimal type; store as REAL so sorting and math work.
            e.Property(x => x.Price).HasConversion<double?>();
            e.HasOne(x => x.Photo).WithOne().HasForeignKey<BeanPhoto>(p => p.BeanId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<BeanPhoto>(e =>
        {
            e.HasKey(p => p.BeanId);
            e.Property(p => p.ContentType).HasMaxLength(50);
            e.Property(p => p.UpdatedAt).HasConversion(
                v => v.ToUniversalTime(),
                v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
        });
    }
}
