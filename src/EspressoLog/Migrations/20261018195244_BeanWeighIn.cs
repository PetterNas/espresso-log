using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EspressoLog.Migrations
{
    /// <inheritdoc />
    public partial class BeanWeighIn : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "LeftAt",
                table: "Beans",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "LeftGrams",
                table: "Beans",
                type: "REAL",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LeftAt",
                table: "Beans");

            migrationBuilder.DropColumn(
                name: "LeftGrams",
                table: "Beans");
        }
    }
}
