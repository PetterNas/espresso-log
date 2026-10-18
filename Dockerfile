# Builds on the host's architecture and cross-publishes for the target (fast on an M-series Mac).
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG TARGETARCH
WORKDIR /src
COPY src/EspressoLog/EspressoLog.csproj src/EspressoLog/
RUN dotnet restore src/EspressoLog -a $TARGETARCH
COPY src/EspressoLog/ src/EspressoLog/
RUN dotnet publish src/EspressoLog -c Release -a $TARGETARCH --no-restore -o /app -p:UseAppHost=false

# Chiseled: no shell or package manager, runs as non-root.
FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ConnectionStrings__Db="Data Source=/data/espresso.db"
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["dotnet", "EspressoLog.dll"]
