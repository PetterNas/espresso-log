using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EspressoLog.Migrations
{
    /// <inheritdoc />
    public partial class ShotTagsAndBest : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "Best",
                table: "Shots",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Tags",
                table: "Shots",
                type: "TEXT",
                nullable: false,
                defaultValue: "[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Best",
                table: "Shots");

            migrationBuilder.DropColumn(
                name: "Tags",
                table: "Shots");
        }
    }
}
