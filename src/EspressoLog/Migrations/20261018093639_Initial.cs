using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EspressoLog.Migrations
{
    /// <inheritdoc />
    public partial class Initial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Beans",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", maxLength: 200, nullable: false),
                    Roaster = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    Origin = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    PurchasedFrom = table.Column<string>(type: "TEXT", maxLength: 200, nullable: true),
                    RoastDate = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    PurchaseDate = table.Column<DateOnly>(type: "TEXT", nullable: true),
                    Price = table.Column<double>(type: "REAL", nullable: true),
                    AmountGrams = table.Column<double>(type: "REAL", nullable: true),
                    Rating = table.Column<int>(type: "INTEGER", nullable: true),
                    Review = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true),
                    Finished = table.Column<bool>(type: "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Beans", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Shots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    CreatedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    GrindSetting = table.Column<double>(type: "REAL", nullable: false),
                    DoseGrams = table.Column<double>(type: "REAL", nullable: false),
                    TimeSeconds = table.Column<int>(type: "INTEGER", nullable: false),
                    BeanId = table.Column<int>(type: "INTEGER", nullable: false),
                    YieldGrams = table.Column<double>(type: "REAL", nullable: true),
                    Rating = table.Column<int>(type: "INTEGER", nullable: true),
                    Notes = table.Column<string>(type: "TEXT", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Shots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Shots_Beans_BeanId",
                        column: x => x.BeanId,
                        principalTable: "Beans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Shots_BeanId",
                table: "Shots",
                column: "BeanId");

            migrationBuilder.CreateIndex(
                name: "IX_Shots_CreatedAt",
                table: "Shots",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Shots");

            migrationBuilder.DropTable(
                name: "Beans");
        }
    }
}
